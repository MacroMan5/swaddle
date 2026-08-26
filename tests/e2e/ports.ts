// The e2e suite binds two consecutive ports (server A: seeded data, server B:
// fresh install). They default to 3000/3001 but honour E2E_PORT_BASE so runs
// can coexist on one machine — the self-hosted CI runner shares this host with
// local development runs, and two suites binding the same ports fail with
// EADDRINUSE. Every spec that needs an absolute origin imports from here.
export const PORT_A = Number(process.env.E2E_PORT_BASE ?? '3000');
export const PORT_B = PORT_A + 1;
export const HOST_A = `localhost:${PORT_A}`;
export const HOST_B = `localhost:${PORT_B}`;
export const BASE_A = `http://${HOST_A}`;
export const BASE_B = `http://${HOST_B}`;
