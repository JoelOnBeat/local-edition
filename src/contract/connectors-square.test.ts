import { describe, expect, it } from "vitest";
import { mockCalendarFeeds, mockDeliveries, mockSales, mockSquareConnect, mockSquareDisconnected, mockSquareStatus, mockSquareSync } from "@/mocks/connectors-square";
import { mockEditionId } from "@/mocks/editions";
import { CalendarFeedsResponse, DeliveriesResponse, SalesResponse, SquareConnectResponse, SquareStatus, SquareSyncResult } from "./connectors-square";

describe("Square and calendar mocks match the contract", () => {
  it("parses every mock", () => {
    expect(SquareStatus.parse(mockSquareStatus)).toBeTruthy();
    expect(SquareStatus.parse(mockSquareDisconnected)).toBeTruthy();
    expect(SquareSyncResult.parse(mockSquareSync)).toBeTruthy();
    expect(SquareConnectResponse.parse(mockSquareConnect)).toBeTruthy();
    expect(CalendarFeedsResponse.parse({ feeds: mockCalendarFeeds }).feeds).toHaveLength(9);
    expect(DeliveriesResponse.parse({ deliveries: mockDeliveries(mockEditionId("store_williamsburg")) }).deliveries).toHaveLength(1);
    expect(SalesResponse.parse(mockSales)).toBeTruthy();
  });
});
