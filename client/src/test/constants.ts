/**
 * Test constants — replaces hardcoded home LAN IPs in test fixtures.
 * Use these instead of literal addresses so tests don't leak personal network info.
 */
export const TEST_SERVER_URL = "http://test-server:3000";
export const TEST_SERVER_HOST = "test-server:3000";
export const TEST_API_URL = `${TEST_SERVER_URL}/api`;