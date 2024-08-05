import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/fetchall/[[...slugs]]/route";
import { getConn, runQuery } from "@/components/processors/processormacros";
import MapperFactory, { IDataMapper } from "@/config/datamapper";
import { createMocks } from "node-mocks-http";
import { NextRequest } from "next/server";

// Mocking getConn and runQuery functions
vi.mock("@/components/processors/processormacros", () => ({
  getConn: vi.fn(),
  runQuery: vi.fn()
}));

// Mocking MapperFactory
vi.mock("@/config/datamapper", () => ({
  default: {
    getMapper: vi.fn()
  }
}));

describe("GET /api/fetchall/[[...slugs]]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 500 if schema is not provided", async () => {
    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/fetchall/plots"
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { slugs: ["plots"] } })).rejects.toThrow("Schema selection was not provided to API endpoint");
  });

  it("should return 500 if fetchType is not provided", async () => {
    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/fetchall?schema=test_schema"
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { slugs: [] } })).rejects.toThrow("fetchType was not correctly provided");
  });

  it("should return 200 and data if query is successful", async () => {
    const mockConn = { release: vi.fn() };
    (getConn as ReturnType<typeof vi.fn>).mockResolvedValue(mockConn);
    const mockResults = [{ PlotID: 1, PlotName: "Plot 1" }];
    (runQuery as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);

    const mockMapper: IDataMapper<any, any> = {
      mapData: vi.fn().mockReturnValue([{ plotID: 1, plotName: "Plot 1" }]),
      demapData: vi.fn()
    };
    (MapperFactory.getMapper as ReturnType<typeof vi.fn>).mockReturnValue(mockMapper);

    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/fetchall/plots?schema=test_schema"
    });

    const mockReq = new NextRequest(req.url);
    const response = await GET(mockReq, { params: { slugs: ["plots"] } });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([{ plotID: 1, plotName: "Plot 1" }]);
    expect(getConn).toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledWith(mockConn, expect.stringContaining("SELECT"));
    expect(mockMapper.mapData).toHaveBeenCalledWith(mockResults);
    expect(mockConn.release).toHaveBeenCalled();
  });

  it("should return 500 if there is a database error", async () => {
    const mockConn = { release: vi.fn() };
    (getConn as ReturnType<typeof vi.fn>).mockResolvedValue(mockConn);
    (runQuery as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Database error"));

    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/fetchall/plots?schema=test_schema"
    });

    const mockReq = new NextRequest(req.url);

    await expect(GET(mockReq, { params: { slugs: ["plots"] } })).rejects.toThrow("Call failed");
    expect(getConn).toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledWith(mockConn, expect.stringContaining("SELECT"));
    expect(mockConn.release).toHaveBeenCalled();
  });
});
