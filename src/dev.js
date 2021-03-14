const API_GATEWAY = process.env.API_GATEWAY;
const LS_ACCESS_TOKEN = process.env.LS_ACCESS_TOKEN;

/**
 * @param {import("../src/sdk/dm-sdk").DataManager} DataManager
 */
export const initDevApp = async (DataManager) => {
  const gatewayAPI = API_GATEWAY ?? "http://localhost:8081/api/dm";
  const useExternalSource = !!gatewayAPI;

  const dm = new DataManager({
    root: document.getElementById("app"),
    polling: false,
    apiGateway: gatewayAPI,
    apiVersion: 2,
    apiMockDisabled: useExternalSource,
    apiHeaders: {
      Authorization: `Token ${LS_ACCESS_TOKEN}`,
    },
    labelStudio: {
      user: {
        pk: 1,
        firstName: "James",
        lastName: "Dean",
      },
    },
    table: {
      hiddenColumns: {
        explore: ["tasks:completed_at", "tasks:data"],
      },
      visibleColumns: {
        labeling: [
          "tasks:id",
          "tasks:was_cancelled",
          "tasks:data.image",
          "tasks:data.text",
          "annotations:id",
          "annotations:task_id",
        ],
      },
    },
  });
};
