import { flow, getRoot, getSnapshot, types } from "mobx-state-tree";
import { DataStore, DataStoreItem } from "../../mixins/DataStore";
import { getAnnotationSnapshot } from "../../sdk/lsf-utils";
import { isDefined } from "../../utils/utils";
import { DynamicModel } from "../DynamicModel";
import { CustomJSON } from "../types";
import { User } from "../Users";

const Assignee = types
  .model("Assignee", {
    id: types.identifierNumber,
    user: types.late(() => types.reference(User)),
    review: types.maybeNull(types.enumeration(["accepted", "rejected", "fixed"])),
    reviewed: types.maybeNull(types.boolean),
    annotated: types.maybeNull(types.boolean),
  })
  .views((self) => ({
    get firstName() { return self.user.firstName; },
    get lastName() { return self.user.lastName; },
    get username() { return self.user.username; },
    get email() { return self.user.email; },
    get lastActivity() { return self.user.lastActivity; },
    get avatar() { return self.user.avatar; },
    get initials() { return self.user.initials; },
    get fullName() { return self.user.fullName; },
  }))
  .preProcessSnapshot((sn) => {
    let result = sn;

    if (typeof sn === 'number') {
      result = {
        id: sn,
        user: sn,
        annotated: true,
        review: null,
        reviewed: false,
      };
    } else {
      const { user_id, user, ...rest } = sn;

      result = {
        ...rest,
        id: user_id ?? user,
        user: user_id ?? user,
      };
    }

    return result;
  });

export const create = (columns) => {
  const TaskModelBase = DynamicModel("TaskModelBase", columns, {
    annotators: types.optional(types.array(Assignee), []),
    reviewers: types.optional(types.array(Assignee), []),
    annotations: types.optional(types.array(CustomJSON), []),
    predictions: types.optional(types.array(CustomJSON), []),
    drafts: types.frozen(),
    source: types.maybeNull(types.string),
    was_cancelled: false,
    assigned_task: false,
  })
    .views((self) => ({
      get lastAnnotation() {
        return self.annotations[this.annotations.length - 1];
      },
    }))
    .actions((self) => ({
      mergeAnnotations(annotations) {
        // skip drafts, they'll be added later
        self.annotations = annotations.filter(a => a.pk).map((c) => {
          const existingAnnotation = self.annotations.find(
            (ec) => ec.id === Number(c.pk),
          );

          if (existingAnnotation) {
            return existingAnnotation;
          } else {
            return {
              id: c.id,
              pk: c.pk,
              draftId: c.draftId,
              result: c.serializeAnnotation(),
              leadTime: c.leadTime,
              userGenerate: !!c.userGenerate,
              sentUserGenerate: !!c.sentUserGenerate,
            };
          }
        });
      },

      updateAnnotation(annotation) {
        const existingAnnotation = self.annotations.find((c) => {
          return c.id === Number(annotation.pk) || c.pk === annotation.pk;
        });

        if (existingAnnotation) {
          Object.assign(existingAnnotation, getAnnotationSnapshot(annotation));
        } else {
          self.annotations.push(getAnnotationSnapshot(annotation));
        }
      },

      deleteAnnotation(annotation) {
        const index = self.annotations.findIndex((c) => {
          return c.id === Number(annotation.pk) || c.pk === annotation.pk;
        });

        if (index >= 0) self.annotations.splice(index, 1);
      },

      deleteDraft(id) {
        if (!self.drafts) return;
        const index = self.drafts.findIndex(d => d.id === id);

        if (index >= 0) self.drafts.splice(index, 1);
      },

      loadAnnotations: flow(function* () {
        const annotations = yield Promise.all([
          getRoot(self).apiCall("annotations", { taskID: self.id }),
        ]);

        self.annotations = annotations[0];
      }),
    }));

  const TaskModel = types.compose("TaskModel", TaskModelBase, DataStoreItem);

  return DataStore("TasksStore", {
    apiMethod: "tasks",
    listItemType: TaskModel,
    properties: {
      totalAnnotations: 0,
      totalPredictions: 0,
    },
  })
    .actions((self) => ({
      loadTask: flow(function* (taskID, { select = true } = {}) {
        if (!isDefined(taskID)) {
          console.warn("Task ID must be provided");
          return;
        }

        self.setLoading(taskID);

        const taskData = yield self.root.apiCall("task", { taskID });

        const task = self.applyTaskSnapshot(taskData, taskID);

        if (select !== false) self.setSelected(task);

        self.finishLoading(taskID);

        return task;
      }),

      loadNextTask: flow(function* ({ select = true } = {}) {
        const taskData = yield self.root.invokeAction("next_task", {
          reload: false,
        });

        if (taskData?.$meta?.status === 404) {
          getRoot(self).SDK.invoke("labelStreamFinished");
          return null;
        }

        const labelStreamModeChanged = self.selected && (
          self.selected.assigned_task !== taskData.assigned_task
          && taskData.assigned_task === false
        );

        const task = self.applyTaskSnapshot(taskData);

        if (select !== false) self.setSelected(task);

        if (labelStreamModeChanged) {
          getRoot(self).SDK.invoke("assignedStreamFinished");
        }

        return task;
      }),

      applyTaskSnapshot(taskData, taskID) {
        let task;

        if (taskData && !taskData?.error) {
          const id = taskID ?? taskData.id;
          const snapshot = self.mergeSnapshot(id, taskData);

          task = self.updateItem(taskID ?? taskData.id, {
            ...snapshot,
            source: JSON.stringify(taskData),
          });
        }

        return task;
      },

      mergeSnapshot(taskID, taskData){
        const task = self.list.find(({ id }) => id === taskID);
        const snapshot = task ? { ...getSnapshot(task) } : {};

        Object.assign(snapshot, taskData);

        if (snapshot.predictions) {
          snapshot.predictions.forEach((p) => {
            p.created_by = (p.model_version?.trim() ?? "") || p.created_by;
          });
        }

        return snapshot;
      },

      unsetTask() {
        self.unset();
      },

      postProcessData(data) {
        const { total_annotations, total_predictions } = data;

        if (total_annotations !== null)
          self.totalAnnotations = total_annotations;
        if (total_predictions !== null)
          self.totalPredictions = total_predictions;
      },

    }))
    .preProcessSnapshot((snapshot) => {
      const { total_annotations, total_predictions, ...sn } = snapshot;

      return {
        ...sn,
        reviewers: (sn.reviewers ?? []).map(r => ({
          id: r,
          annotated: false,
          review: null,
        })),
        totalAnnotations: total_annotations,
        totalPredictions: total_predictions,
      };
    });
};
