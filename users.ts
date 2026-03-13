export enum UserRole {
  ACCOUNTS = 'accounts',
  LOGISTICS = 'logistics',
  TRANSPORT = 'transport'
}

export const TEAM_NAMES: Record<UserRole, string> = {
  [UserRole.ACCOUNTS]: 'Accounts Team',
  [UserRole.LOGISTICS]: 'Shipping Department',
  [UserRole.TRANSPORT]: 'Transport Team',
};
