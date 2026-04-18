import { renderHook, waitFor } from "@testing-library/react";

import type { UpdateStatusPayload } from "@/api/update-adapter";

import { useUpdateStatus } from "./useUpdateStatus";

const getUpdateStatusMock = vi.fn<() => Promise<UpdateStatusPayload>>();

vi.mock("@/api/update-adapter", () => ({
  getUpdateStatus: () => getUpdateStatusMock(),
}));

describe("useUpdateStatus", () => {
  beforeEach(() => {
    getUpdateStatusMock.mockReset();
  });

  it("reports hasUpdateAvailable=false when no update is available", async () => {
    getUpdateStatusMock.mockResolvedValue({
      channel: "stable",
      current_version: "26.4.19",
      latest_stable_version: "26.4.19",
      update_available: false,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });

    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasUpdateAvailable).toBe(false);
    expect(result.current.updateStatus?.update_available).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports hasUpdateAvailable=true when an update is available", async () => {
    getUpdateStatusMock.mockResolvedValue({
      channel: "stable",
      current_version: "26.4.18",
      latest_stable_version: "26.4.19",
      update_available: true,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });

    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(result.current.hasUpdateAvailable).toBe(true);
    });

    expect(result.current.error).toBeNull();
  });
});
