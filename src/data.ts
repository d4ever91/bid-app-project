import type { ActivityItem, AuditEvent, Role, RoleInfo, Status, User } from './types';

export const USERS: User[] = [
  { id: 'u_10428', name: 'Priya Raghunathan', email: 'p.raghunathan@ordinal.io', role: 'Owner', team: 'Platform', status: 'Active', seen: '2m ago', mfa: 'Enrolled · TOTP', pwAge: '31 days', sessions: '3 devices', joined: 'Mar 2023', location: 'Bengaluru, IN' },
  { id: 'u_10517', name: 'Tomas Lindqvist', email: 't.lindqvist@ordinal.io', role: 'Admin', team: 'Infrastructure', status: 'Active', seen: '18m ago', mfa: 'Enrolled · WebAuthn', pwAge: '12 days', sessions: '2 devices', joined: 'Jun 2023', location: 'Stockholm, SE' },
  { id: 'u_10604', name: 'Marisol Quintero', email: 'm.quintero@ordinal.io', role: 'Engineer', team: 'Data', status: 'Active', seen: '1h ago', mfa: 'Enrolled · TOTP', pwAge: '88 days', sessions: '1 device', joined: 'Sep 2023', location: 'Mexico City, MX' },
  { id: 'u_10712', name: 'Devon Ashworth', email: 'd.ashworth@ordinal.io', role: 'Engineer', team: 'Platform', status: 'Active', seen: '3h ago', mfa: 'Not enrolled', pwAge: '214 days', sessions: '4 devices', joined: 'Nov 2023', location: 'Austin, US' },
  { id: 'u_10790', name: 'Nadia Beshara', email: 'n.beshara@ordinal.io', role: 'Admin', team: 'Security', status: 'Active', seen: '5h ago', mfa: 'Enrolled · WebAuthn', pwAge: '7 days', sessions: '2 devices', joined: 'Jan 2024', location: 'Cairo, EG' },
  { id: 'u_10844', name: 'Ruben Castellanos', email: 'r.castellanos@ordinal.io', role: 'Read-only', team: 'IT Operations', status: 'Invited', seen: '—', mfa: 'Pending', pwAge: '—', sessions: '0 devices', joined: 'Aug 2026', location: 'Madrid, ES' },
  { id: 'u_10902', name: 'Hana Kobayashi', email: 'h.kobayashi@ordinal.io', role: 'Engineer', team: 'Infrastructure', status: 'Active', seen: 'yesterday', mfa: 'Enrolled · TOTP', pwAge: '44 days', sessions: '1 device', joined: 'Feb 2024', location: 'Osaka, JP' },
  { id: 'u_11033', name: 'Gideon Mwangi', email: 'g.mwangi@ordinal.io', role: 'Engineer', team: 'Data', status: 'Suspended', seen: '12 days ago', mfa: 'Enrolled · TOTP', pwAge: '301 days', sessions: '0 devices', joined: 'Apr 2024', location: 'Nairobi, KE' },
  { id: 'u_11108', name: 'Beatrix Vance', email: 'b.vance@ordinal.io', role: 'Read-only', team: 'Security', status: 'Active', seen: '2 days ago', mfa: 'Enrolled · WebAuthn', pwAge: '19 days', sessions: '1 device', joined: 'Jul 2024', location: 'Toronto, CA' },
  { id: 'u_11216', name: 'Elias Fonseca', email: 'e.fonseca@ordinal.io', role: 'Engineer', team: 'Platform', status: 'Invited', seen: '—', mfa: 'Pending', pwAge: '—', sessions: '0 devices', joined: 'Aug 2026', location: 'Lisbon, PT' },
  { id: 'u_11290', name: 'Wen Zhao', email: 'w.zhao@ordinal.io', role: 'Admin', team: 'IT Operations', status: 'Active', seen: '4h ago', mfa: 'Enrolled · TOTP', pwAge: '56 days', sessions: '3 devices', joined: 'Oct 2024', location: 'Singapore, SG' },
  { id: 'u_11355', name: 'Solveig Haugen', email: 's.haugen@ordinal.io', role: 'Engineer', team: 'Data', status: 'Active', seen: '36m ago', mfa: 'Not enrolled', pwAge: '129 days', sessions: '2 devices', joined: 'Feb 2025', location: 'Oslo, NO' }
];

export const ROLE_INFO: Record<Role, RoleInfo> = {
  'Owner': { desc: 'Full control including billing, org deletion, and owner transfer.', scopes: ['org:admin', 'billing:write', 'users:write', 'audit:read'] },
  'Admin': { desc: 'Manages users, roles, and integrations. Cannot transfer ownership.', scopes: ['users:write', 'roles:write', 'audit:read'] },
  'Engineer': { desc: 'Deploys and reads service data. No access to user management.', scopes: ['deploy:write', 'services:read', 'logs:read'] },
  'Read-only': { desc: 'Views dashboards and reports. No mutating actions anywhere.', scopes: ['services:read', 'reports:read'] }
};

export const ROLES = Object.keys(ROLE_INFO) as Role[];
export const TOTAL_USERS = 248;

export const CHART: number[] = [42, 58, 61, 47, 96, 121, 133, 118, 104, 149, 162, 141, 88, 71, 155, 168, 174, 159, 132, 97, 84, 178, 191, 186, 172, 145, 102, 91, 197, 214];

export const EVENTS: AuditEvent[] = [
  { time: '14:02:11', actor: 'Avery Mercer', text: 'Changed role for w.zhao@ordinal.io from Engineer to Admin', kind: 'role', fg: '#0d5a4e', bd: '#c4ded7' },
  { time: '13:47:52', actor: 'System', text: 'Invite expired for legacy-svc@ordinal.io after 72h', kind: 'invite', fg: '#8a5a10', bd: '#e6d4b3' },
  { time: '13:12:08', actor: 'Nadia Beshara', text: 'Suspended g.mwangi@ordinal.io — offboarding ticket IT-4417', kind: 'status', fg: '#932f2f', bd: '#e6c4c4' },
  { time: '12:55:30', actor: 'Avery Mercer', text: 'Sent password reset to d.ashworth@ordinal.io', kind: 'auth', fg: '#4a5250', bd: '#dfe2e3' },
  { time: '11:38:44', actor: 'Directory sync', text: 'Provisioned 3 accounts from Okta group eng-platform', kind: 'sync', fg: '#4a5250', bd: '#dfe2e3' }
];

export const ACTIVITY: ActivityItem[] = [
  { time: '2m ago', text: 'Signed in from 51.15.44.2 · Chrome 129 on macOS' },
  { time: '4h ago', text: 'Rotated personal API token pat_9f2c…a11' },
  { time: 'yesterday', text: 'Approved access request for Marisol Quintero' },
  { time: '3 days ago', text: 'Enrolled a new WebAuthn security key' },
  { time: '11 days ago', text: 'Role changed from Admin to Owner by Avery Mercer' }
];

export const initials = (name: string): string =>
  name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

export const statusDot = (status: Status): string => {
  if (status === 'Active') return '#0d7a6a';
  if (status === 'Invited') return '#c98a1e';
  return '#b23a3a';
};

export const maskEmail = (email: string, on: boolean): string =>
  on ? email.replace(/^(.).*(@.*)$/, (_m, a: string, b: string) => a + '•••••' + b) : email;

export const mfaColor = (mfa: string): string =>
  mfa === 'Not enrolled' ? '#b23a3a' : mfa === 'Pending' ? '#8a5a10' : 'var(--accent)';
