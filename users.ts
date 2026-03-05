export enum UserRole {
  ACCOUNTS = 'accounts',
  LOGISTICS = 'logistics',
  TRANSPORT = 'transport'
}

export interface User {
  username: string;
  password: string; // In a real app, this would be hashed!
  role: UserRole;
  teamName: string;
}

export const USERS: User[] = [
  {
    username: 'mongmong',
    password: '12345',
    role: UserRole.ACCOUNTS,
    teamName: 'Accounts Team'
  },
  {
    username: 'Dongdong',
    password: '67!',
    role: UserRole.LOGISTICS,
    teamName: 'Logistics Team'
  },
  {
    username: 'Tungtung',
    password: 'weezyouttahere',
    role: UserRole.TRANSPORT,
    teamName: 'Transport Team'
  }
];

export const authenticate = (username: string, password: string): User | null => {
  const user = USERS.find(u => u.username === username && u.password === password);
  return user || null;
};
