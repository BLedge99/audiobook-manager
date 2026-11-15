/**
 * The AccountGate mode union and account shape (spec 41 phase 8).
 *
 * Mode drives the whole state machine: `list` shows the accounts (household)
 * or the production-demo sign-in (demo), and the other kinds each render one
 * form. `email` carries `signup` so the list's "create account" entry can
 * open the same form in create mode.
 */
export interface Account {
  id: number;
  name: string;
  color?: string | null;
  role: "admin" | "member";
  disabled: boolean;
  hasPassword: boolean;
  hasPasskey: boolean;
  hasDeviceUnlock: boolean;
}

export type Mode =
  | { kind: "list" }
  | { kind: "password"; account: Account }
  | { kind: "setup"; account: Account }
  | { kind: "household" }
  | { kind: "register" }
  | { kind: "email"; signup: boolean };
