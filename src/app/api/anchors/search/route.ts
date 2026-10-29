import { routes } from "@/contract";
import { withRoute } from "@/server/http/api";
import { searchBrands } from "@/server/qloo";

export const GET = withRoute(routes.searchAnchors, ({ query }) => searchBrands(query.q));
