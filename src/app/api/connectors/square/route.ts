import { disconnectSquareRoute, getSquare } from "@/server/connectors/square/handlers";

export const GET = getSquare;
export const DELETE = disconnectSquareRoute;
