import { staffRole, isManager, canChangeRole, changeRole } from './roles.js';

const account = (id, role) => ({ id, app_metadata: { role, provider: 'email' } });
const owner = account('owner', 'owner');
const adminUser = account('admin', 'admin');
const staff = account('staff', 'staff');
function assert(value, message) {
  if (!value) throw new Error(message);
}

Deno.test('verified roles grant owner and admin dashboard access only', () => {
  assert(isManager(owner) && isManager(adminUser), 'Managers need dashboard access');
  assert(!isManager(staff), 'Staff cannot manage accounts');
  assert(staffRole({ user_metadata: { role: 'owner' } }) === 'staff', 'Editable metadata must not grant permissions');
  assert(staffRole({ app_metadata: { role: 'unexpected' } }) === 'staff', 'Unknown roles default to staff');
});

Deno.test('only owners can change other non-owner roles', () => {
  assert(canChangeRole(owner, adminUser) && canChangeRole(owner, staff), 'Owners can manage admin and staff roles');
  assert(!canChangeRole(owner, owner), 'Owners cannot change their own role');
  assert(!canChangeRole(owner, account('other-owner', 'owner')), 'Owner targets are protected');
  assert(!canChangeRole(adminUser, staff) && !canChangeRole(staff, adminUser), 'Non-owners cannot change roles');
});

Deno.test('role changes enforce permissions, allowed roles, and metadata preservation', async () => {
  const calls = [];
  const admin = { auth: { admin: { updateUserById: async (...args) => {
    calls.push(args);
    return { error: null };
  } } } };
  const reply = (status, body) => ({ status, body });
  for (const [user, target, role, expected] of [
    [adminUser, staff, 'admin', 403],
    [staff, adminUser, 'staff', 403],
    [owner, owner, 'staff', 403],
    [owner, account('other-owner', 'owner'), 'staff', 403],
    [owner, staff, 'owner', 400],
    [owner, staff, 'unexpected', 400],
    [owner, staff, null, 400],
  ]) {
    const result = await changeRole({ admin, user, staff: target, role, reply });
    assert(result.status === expected, `Unexpected permission result: ${result.status}`);
  }
  assert(calls.length === 0, 'Rejected requests must not write metadata');
  for (const [target, role] of [[staff, 'admin'], [adminUser, 'staff']]) {
    const result = await changeRole({ admin, user: owner, staff: target, role, reply });
    assert(result.status === 200 && result.body.role === role, 'Valid changes should succeed');
    const [id, update] = calls.at(-1);
    assert(id === target.id && update.app_metadata.role === role, 'Update the selected account');
    assert(update.app_metadata.provider === 'email', 'Preserve unrelated app metadata');
  }
});

Deno.test('role save errors are reported', async () => {
  const admin = { auth: { admin: { updateUserById: async () => ({ error: new Error('Unavailable') }) } } };
  const result = await changeRole({ admin, user: owner, staff, role: 'admin', reply: (status, body) => ({ status, body }) });
  assert(result.status === 502 && !result.body.saved, 'Do not report success after a failed write');
});
