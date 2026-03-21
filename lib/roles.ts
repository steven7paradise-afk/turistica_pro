export const APP_ROLES = ["ADMIN", "MANAGER", "STAFF"] as const;

export type AppRole = (typeof APP_ROLES)[number];
