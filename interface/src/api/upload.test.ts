import { requestPresignedUrl, uploadFile, uploadToS3 } from "./upload";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../shared/api/core", () => ({ apiFetch: mocks.apiFetch }));

class UploadRequest {
  static instances: UploadRequest[] = [];
  static failToSend = false;
  status = 0;
  responseText = "";
  timeout = 0;
  upload = { onprogress: undefined as ((event: ProgressEvent) => void) | undefined };
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => { if (UploadRequest.failToSend) throw new Error("request details"); });
  abort = vi.fn(() => this.onabort?.());
  constructor() { UploadRequest.instances.push(this); }
}

beforeEach(() => {
  vi.resetAllMocks();
  UploadRequest.instances = [];
  UploadRequest.failToSend = false;
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  mocks.apiFetch.mockResolvedValue({
    upload_url: "https://bucket.example/signed-upload", file_url: "https://files.example/photo.jpg",
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("uploads the blob with its signed content type, reports progress, and returns a durable URL", async () => {
  const progress = vi.fn();
  const blob = new Blob([new Uint8Array(1_080_000)], { type: "image/jpeg" });
  const promise = uploadFile(blob, "photo.jpg", blob.type, progress);
  await vi.waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
  const xhr = UploadRequest.instances[0];
  expect(xhr.open).toHaveBeenCalledWith("PUT", "https://bucket.example/signed-upload");
  expect(xhr.setRequestHeader).toHaveBeenCalledWith("Content-Type", "image/jpeg");
  expect(xhr.send).toHaveBeenCalledWith(blob);
  xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
  expect(progress).toHaveBeenCalledWith(50);
  xhr.status = 200;
  xhr.onload?.();
  await expect(promise).resolves.toBe("https://files.example/photo.jpg");
});

it("surfaces the S3 denial code without leaking the XML body or signed URL", async () => {
  const promise = uploadToS3("https://bucket.example/?credential=secret", new Blob(), "image/jpeg");
  const assertion = expect(promise).rejects.toThrow("S3 upload failed: HTTP 403 (SignatureDoesNotMatch)");
  const xhr = UploadRequest.instances[0];
  xhr.status = 403;
  xhr.responseText = "<Error><Code>SignatureDoesNotMatch</Code><Message>secret signing details</Message></Error>";
  xhr.onload?.();
  await assertion;
});

it("does not expose unrecognized S3 response details", async () => {
  const promise = uploadToS3("https://bucket.example/put", new Blob(), "image/jpeg");
  const assertion = expect(promise).rejects.toThrow(/^S3 upload failed: HTTP 403$/);
  const xhr = UploadRequest.instances[0];
  xhr.status = 403;
  xhr.responseText = "<Code>secret/signing details</Code>";
  xhr.onload?.();
  await assertion;
});

it("cleans up cancellation if the browser cannot start the request", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  UploadRequest.failToSend = true;
  await expect(uploadToS3("https://bucket.example/put", new Blob(), "image/jpeg", undefined, controller.signal)).rejects.toThrow("could not start request");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it.each(["error", "timeout"] as const)("settles a %s and removes the abort listener", async (event) => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const promise = uploadToS3("https://bucket.example/put", new Blob(), "image/jpeg", undefined, controller.signal);
  const assertion = expect(promise).rejects.toThrow(event === "error" ? "network error" : "timeout");
  const xhr = UploadRequest.instances[0];
  expect(xhr.timeout).toBe(120_000);
  if (event === "error") xhr.onerror?.(); else xhr.ontimeout?.();
  await assertion;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  controller.abort();
  expect(xhr.abort).not.toHaveBeenCalled();
});

it("aborts in-flight uploads and refuses to start one with an already-aborted signal", async () => {
  const controller = new AbortController();
  const promise = uploadToS3("https://bucket.example/put", new Blob(), "image/jpeg", undefined, controller.signal);
  const assertion = expect(promise).rejects.toThrow("aborted");
  controller.abort();
  await assertion;
  expect(UploadRequest.instances[0].abort).toHaveBeenCalledOnce();
  await expect(uploadToS3("https://bucket.example/put", new Blob(), "image/jpeg", undefined, controller.signal)).rejects.toThrow("aborted");
  expect(UploadRequest.instances).toHaveLength(1);
});

it("forwards cancellation and a finite timeout to the presign request", async () => {
  const controller = new AbortController();
  await requestPresignedUrl("image/jpeg", "photo.jpg", "photos", controller.signal);
  expect(mocks.apiFetch).toHaveBeenCalledWith("/api/upload/presign", expect.objectContaining({
    signal: controller.signal, timeoutMs: 30_000,
    body: JSON.stringify({ content_type: "image/jpeg", filename: "photo.jpg", prefix: "photos" }),
  }));
});

it("does not PUT if cancellation happens while presign is pending", async () => {
  const controller = new AbortController();
  let finish!: (value: object) => void;
  mocks.apiFetch.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const promise = uploadFile(new Blob(), "photo.jpg", "image/jpeg", undefined, controller.signal);
  const assertion = expect(promise).rejects.toThrow("aborted");
  controller.abort();
  finish({ upload_url: "https://bucket.example/put", file_url: "https://files.example/photo.jpg" });
  await assertion;
  expect(UploadRequest.instances).toHaveLength(0);
});
