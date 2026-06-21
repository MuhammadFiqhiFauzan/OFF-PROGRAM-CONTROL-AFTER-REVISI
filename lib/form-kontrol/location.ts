/*
 * Tujuan: Helper geolocation klien untuk menangkap koordinat saat check-in/foto kunjungan.
 * Caller: components/form-kontrol/camera-capture.tsx & visit wizard (page.tsx).
 * Dependensi: navigator.geolocation (native browser, zero dependency).
 * Main Functions: getCurrentCoords.
 * Side Effects: Memicu prompt izin lokasi browser.
 */
export interface GeoCoords {
    lat: number;
    lng: number;
    accuracy: number; // meter
}

// ponytail: native geolocation, no lib. Resolve null (bukan reject) supaya flow tidak terblokir
// kalau user tolak izin / GPS mati — anti-fraud cukup di-FLAG server-side, bukan memblok kunjungan.
export function getCurrentCoords(timeoutMs = 8000): Promise<GeoCoords | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
            }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
        );
    });
}
