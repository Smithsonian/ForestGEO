import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/filehandlers/downloadallfiles/route";
import { getContainerClient } from "@/config/macros/azurestorage";
import { createMocks } from "node-mocks-http";
import { NextRequest } from "next/server";

vi.mock("@/config/macros/azurestorage", () => ({
  getContainerClient: vi.fn()
}));

describe("GET /api/filehandlers/downloadallfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 if plot or census is not provided", async () => {
    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/filehandlers/downloadallfiles"
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe("Both plot and census parameters are required");
  });

  it("should return 400 if container client creation fails", async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/filehandlers/downloadallfiles?plot=testPlot&census=testCensus"
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.statusText).toBe("Container client creation error");
  });

  it("should return 200 and list of blobs if successful", async () => {
    const mockContainerClient = {
      listBlobsFlat: vi.fn().mockImplementation(function* () {
        yield {
          name: "testBlob",
          metadata: {
            user: "testUser",
            FormType: "testFormType",
            FileErrorState: JSON.stringify([{ stemtag: "testStemtag", tag: "testTag", validationErrorID: 1 }])
          },
          properties: {
            lastModified: new Date()
          }
        };
      })
    };

    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainerClient);

    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/filehandlers/downloadallfiles?plot=testPlot&census=testCensus"
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.responseMessage).toBe("List of files");
    expect(data.blobData).toHaveLength(1);
    expect(data.blobData[0]).toEqual({
      key: 1,
      name: "testBlob",
      user: "testUser",
      formType: "testFormType",
      fileErrors: [{ stemtag: "testStemtag", tag: "testTag", validationErrorID: 1 }],
      date: expect.any(String) // Date will be serialized to a string
    });
  });

  it("should return 400 if there is an error in blob listing", async () => {
    const mockContainerClient = {
      listBlobsFlat: vi.fn().mockImplementation(() => {
        throw new Error("Blob listing error");
      })
    };

    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockContainerClient);

    const { req } = createMocks({
      method: "GET",
      url: "http://localhost/api/filehandlers/downloadallfiles?plot=testPlot&census=testCensus"
    });

    const mockReq = new NextRequest(req.url);

    const response = await GET(mockReq);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe("Blob listing error");
  });
});
