import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/filehandlers/storageload/route";
import { getContainerClient, uploadValidFileAsBuffer } from "@/config/macros/azurestorage";
import { createMocks } from "node-mocks-http";
import { NextRequest } from "next/server";

vi.mock("@/config/macros/azurestorage", () => ({
  getContainerClient: vi.fn(),
  uploadValidFileAsBuffer: vi.fn()
}));

describe.skip("POST /api/filehandlers/storageload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockRequest = (url: string, formData: FormData) => {
    const { req } = createMocks({
      method: "POST",
      url: url,
      headers: {
        "Content-Type": "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW"
      }
    });

    if (formData.get("file") === null) {
      console.log("createMockRequest: received empty formData: ", formData);
      return new NextRequest(req.url!, { method: "POST" });
    }
    req.formData = async () => formData;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      headers.append(key, value as string);
    }

    const body = `------WebKitFormBoundary7MA4YWxkTrZu0gW\r\nContent-Disposition: form-data; name="file"; filename="testfile.txt"\r\nContent-Type: text/plain\r\n\r\ntest content\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--`;

    return new NextRequest(req.url!, { method: "POST", headers, body });
  };

  it("should return 500 if container client creation fails", async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Test error"));

    const formData = new FormData();
    formData.append("file", new File(["test content"], "testfile.txt"));

    const mockReq = createMockRequest(
      "http://localhost/api/filehandlers/storageload?fileName=testfile.txt&plot=testplot&census=testcensus&user=testuser&formType=testform",
      formData
    );

    const response = await POST(mockReq);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.responseMessage).toBe("Error getting container client.");
    expect(data.error).toBe("Test error");
  });

  it("should return 500 if file upload fails", async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (uploadValidFileAsBuffer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Upload error"));

    const formData = new FormData();
    formData.append("file", new File(["test content"], "testfile.txt"));

    const mockReq = createMockRequest(
      "http://localhost/api/filehandlers/storageload?fileName=testfile.txt&plot=testplot&census=testcensus&user=testuser&formType=testform",
      formData
    );

    const response = await POST(mockReq);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.responseMessage).toBe("File Processing error");
    expect(data.error).toBe("Upload error");
  });

  it("should return 200 if file upload is successful", async () => {
    const mockUploadResponse = { requestId: "12345", _response: { status: 200 } };
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (uploadValidFileAsBuffer as ReturnType<typeof vi.fn>).mockResolvedValue(mockUploadResponse);

    const formData = new FormData();
    formData.append("file", new File(["test content"], "testfile.txt"));

    const mockReq = createMockRequest(
      "http://localhost/api/filehandlers/storageload?fileName=testfile.txt&plot=testplot&census=testcensus&user=testuser&formType=testform",
      formData
    );

    const response = await POST(mockReq);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Insert to Azure Storage successful");
  });

  it("should return 400 if file is missing", async () => {
    const formData = new FormData();
    console.log("test formData: ", formData);

    const mockReq = createMockRequest(
      "http://localhost/api/filehandlers/storageload?fileName=testfile.txt&plot=testplot&census=testcensus&user=testuser&formType=testform",
      formData
    );

    const response = await POST(mockReq);
    expect(response.status).toBe(400);
    const data = await response.text();
    expect(data).toBe("File is required");
  });

  it("should return 500 for unknown errors", async () => {
    (getContainerClient as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (uploadValidFileAsBuffer as ReturnType<typeof vi.fn>).mockRejectedValue("Unknown error");

    const formData = new FormData();
    formData.append("file", new File(["test content"], "testfile.txt"));

    const mockReq = createMockRequest(
      "http://localhost/api/filehandlers/storageload?fileName=testfile.txt&plot=testplot&census=testcensus&user=testuser&formType=testform",
      formData
    );

    const response = await POST(mockReq);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.responseMessage).toBe("File Processing error");
    expect(data.error).toBe("Unknown error");
  });
});
