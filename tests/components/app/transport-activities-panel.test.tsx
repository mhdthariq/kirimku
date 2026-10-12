// @vitest-environment jsdom
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportActivitiesPanel } from "@/components/app/transport-activities-panel";
import { ActivityCamera } from "@/components/app/activity-camera";

const m = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    gps: vi.fn(),
    camera: vi.fn(),
    stop: vi.fn(),
    draw: vi.fn(),
}));
vi.mock("@/infrastructure/http/client-api", () => ({
    apiGet: m.get,
    apiPost: m.post,
}));
vi.mock("next/image", () => ({
    default: ({
        unoptimized: _unoptimized,
        ...props
    }: React.ImgHTMLAttributes<HTMLImageElement> & {
        unoptimized?: boolean;
    }) => <img {...props} alt={props.alt ?? ""} />,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
    vi.resetAllMocks();
    m.get.mockResolvedValue([]);
    m.post.mockResolvedValue({ id: 1 });
    m.camera.mockResolvedValue({
        getTracks: () => [{ stop: m.stop }],
        getVideoTracks: () => [{ readyState: "live" }],
    });
    m.gps.mockImplementation((success) =>
        success({ coords: { latitude: 0, longitude: 106.8, accuracy: 5 } }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: m.camera },
    });
    Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: m.gps },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: m.draw,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
        "data:image/jpeg;base64,YQ==",
    );
});

async function cameraReady() {
    const video = screen.getByLabelText("Pratinjau kamera aktivitas");
    Object.defineProperties(video, {
        videoWidth: { configurable: true, value: 1920 },
        videoHeight: { configurable: true, value: 1080 },
    });
    await waitFor(() => expect(m.camera).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.loadedData(video);
}
async function takePhoto() {
    fireEvent.click(
        screen.getByRole("button", { name: "Tambah Foto Aktivitas" }),
    );
    await cameraReady();
    fireEvent.click(
        screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
    );
    await screen.findByRole("button", { name: "Simpan Foto" });
}

describe("camera-only activity evidence", () => {
    it("captures live video with fresh GPS, saves repeated entries, and stops the camera", async () => {
        const changed = vi.fn();
        const { container } = render(
            <TransportActivitiesPanel
                transportId={10}
                canCreate
                onChanged={changed}
            />,
        );
        await takePhoto();
        expect(container.querySelector('input[type="file"]')).toBeNull();
        expect(m.camera).toHaveBeenCalledWith({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
        });
        expect(m.gps).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        );
        expect(m.draw).toHaveBeenCalledWith(
            expect.any(HTMLVideoElement),
            0,
            0,
            1280,
            720,
        );
        expect(m.stop).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Simpan Foto" }));
        await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
        expect(m.post).toHaveBeenCalledWith("/transports/10/activities", {
            photo: "data:image/jpeg;base64,YQ==",
            latitude: 0,
            longitude: 106.8,
            locationAccuracy: 5,
            capturedAt: expect.any(String),
        });
        expect(
            Number.isFinite(Date.parse(m.post.mock.calls[0][1].capturedAt)),
        ).toBe(true);
        await takePhoto();
        fireEvent.click(screen.getByRole("button", { name: "Simpan Foto" }));
        await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
        expect(m.gps).toHaveBeenCalledTimes(2);
        expect(m.post).toHaveBeenCalledTimes(2);
    });

    it("blocks capture on denied GPS and permits retry", async () => {
        m.gps.mockImplementationOnce((_success, failure) =>
            failure({ code: 1 }),
        );
        const captured = vi.fn();
        render(<ActivityCamera onCaptured={captured} />);
        await cameraReady();
        fireEvent.click(
            screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent("GPS gagal");
        expect(captured).not.toHaveBeenCalled();
        expect(m.draw).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
        );
        await waitFor(() => expect(captured).toHaveBeenCalledOnce());
    });

    it("blocks when GPS is unavailable or coordinates are invalid", async () => {
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: undefined,
        });
        const captured = vi.fn();
        render(<ActivityCamera onCaptured={captured} />);
        await cameraReady();
        fireEvent.click(
            screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "GPS tidak tersedia",
        );
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: { getCurrentPosition: m.gps },
        });
        m.gps.mockImplementation((success) =>
            success({ coords: { latitude: NaN, longitude: 10, accuracy: 5 } }),
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "GPS tidak valid",
        );
        expect(captured).not.toHaveBeenCalled();
    });

    it("blocks without camera and stops a late stream after unmount", async () => {
        m.camera.mockRejectedValueOnce(new Error("denied"));
        const { unmount } = render(<ActivityCamera onCaptured={vi.fn()} />);
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Kamera gagal",
        );
        expect(
            screen.getByRole("button", { name: "Ambil Foto dengan GPS" }),
        ).toBeDisabled();
        unmount();
        let resolve!: (value: unknown) => void;
        m.camera.mockReturnValueOnce(
            new Promise((done) => {
                resolve = done;
            }),
        );
        const late = render(<ActivityCamera onCaptured={vi.fn()} />);
        late.unmount();
        await act(async () => {
            resolve({ getTracks: () => [{ stop: m.stop }] });
        });
        expect(m.stop).toHaveBeenCalledOnce();
    });

    it("retains evidence on save failure, retries, and displays metadata/map links", async () => {
        m.get.mockResolvedValue([
            {
                id: 3,
                photoUrl: "data:image/jpeg;base64,YQ==",
                latitude: 0,
                longitude: 106.8,
                locationAccuracy: 5,
                capturedAt: "2026-10-13T01:00:00Z",
                recordedAt: "2026-10-13T01:00:01Z",
                recordedByUsername: "driver1",
            },
        ]);
        m.post.mockRejectedValueOnce(new Error("Network error"));
        const changed = vi.fn();
        render(
            <TransportActivitiesPanel
                transportId={10}
                canCreate
                onChanged={changed}
            />,
        );
        expect(
            await screen.findByRole("link", { name: "Lihat lokasi di peta" }),
        ).toHaveAttribute("href", "https://www.google.com/maps?q=0,106.8");
        expect(screen.getByText(/driver1/)).toBeInTheDocument();
        await takePhoto();
        fireEvent.click(screen.getByRole("button", { name: "Simpan Foto" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Network error",
        );
        expect(changed).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Simpan Foto" }));
        await waitFor(() => expect(changed).toHaveBeenCalledOnce());
        expect(m.post.mock.calls[0][1]).toEqual(m.post.mock.calls[1][1]);
    });

    it("handles list failures and prevents read-only camera access", async () => {
        m.get.mockRejectedValueOnce(new Error("Forbidden"));
        render(
            <TransportActivitiesPanel
                transportId={10}
                canCreate={false}
                onChanged={vi.fn()}
            />,
        );
        expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
        expect(
            screen.queryByRole("button", { name: "Tambah Foto Aktivitas" }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
        expect(
            await screen.findByText("Belum ada foto aktivitas."),
        ).toBeInTheDocument();
        expect(m.camera).not.toHaveBeenCalled();
    });
});
