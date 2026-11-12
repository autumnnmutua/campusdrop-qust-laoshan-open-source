/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-D7F840D20D */
/** v3.6 · 成效看板: what the service has done for students, from real (non-demo) delivered orders. */
export interface ImpactWindow {
  /** Delivered orders (one per parcel). */
  deliveries: number;
  /** Trips a student did not have to make: a merged delivery counts once. */
  trips: number;
  /** Walking a student saved: station → dorm (or drop-off point) and back, along campus roads, in km (estimate). */
  walkKm: number;
  walkHours: number;
  /** Deliveries made while the logged weather was rain/snow or worse. */
  wetDeliveries: number;
  students: number;
}
export interface Impact {
  all: ImpactWindow;
  last7: ImpactWindow;
  /** On-time share of the last 30 days (booked window: by its end; as soon as possible: within 60 minutes), 0–100. */
  onTimeRate: number | null;
  onTimeSample: number;
  /** Merged deliveries: parcels that shared a trip. */
  mergedParcels: number;
  since: string | null;
  generatedAt: number;
}
