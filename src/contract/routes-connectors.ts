import { z } from "zod";
import { ConnectionsResponse } from "./connectors";
import { squareRoutes } from "./connectors-square";
import type { RouteSpec } from "./route-spec";

/**
 * The connector routes the shared ApiClient calls. They are kept out of `routes` (the page and handler tables) on purpose: their
 * handlers live in src/server/connectors/ and are tested there. `listDeliveries` is B2's spec, re-exported so the client and the
 * handler share one definition.
 */

export const getConnectionsSpec = {
  method: "GET", path: "/api/connections", stream: "E", bodyKind: "none", sse: false,
  request: z.object({}), response: ConnectionsResponse,
} as const satisfies RouteSpec;

export const connectorApiRoutes = {
  listDeliveries: squareRoutes.listDeliveries,
  getConnections: getConnectionsSpec,
} as const;
