import { SERVICE_LOGOS } from "../PersonalAgentSection/brand-logos";

/**
 * The services shown on the trust device's button rail — the first eight of
 * the shared `SERVICE_LOGOS` set. Kept in its own module so both the rail
 * component and the connection mesh can read the count without tripping the
 * Fast Refresh "components only" rule on the component files.
 */
export const RAIL_LOGOS = SERVICE_LOGOS.slice(0, 8);
