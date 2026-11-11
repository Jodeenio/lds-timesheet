// Roles are read only from verified Auth app metadata, never user metadata.
export function staffRole(user) {
  const role = user.app_metadata?.role;
  return ['owner', 'admin'].includes(role) ? role : 'staff';
}

export function isManager(user) {
  return ['owner', 'admin'].includes(staffRole(user));
}

export function canChangeRole(user, staff) {
  return staffRole(user) === 'owner' && user.id !== staff.id && staffRole(staff) !== 'owner';
}

export async function changeRole({ admin, user, staff, role, reply }) {
  if (!canChangeRole(user, staff)) return reply(403, { error: 'Only owners can change other staff or administrator roles. Owner accounts must be managed in Supabase.' });
  if (!['admin', 'staff'].includes(role)) return reply(400, { error: 'Choose Admin or Staff.' });
  const { error } = await admin.auth.admin.updateUserById(staff.id, {
    app_metadata: { ...staff.app_metadata, role },
  });
  if (error) return reply(502, { error: 'Could not save the role. Refresh the employee settings and try again.' });
  return reply(200, { saved: true, role });
}
