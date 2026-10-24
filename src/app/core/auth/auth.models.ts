/** ITPO staff have no organisation; an organiser belongs to one. */
export type UserType = 'itpo_staff' | 'organiser';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  type: UserType;
  roles: string[];
  orgId: string | null;
  /** An organiser's organisation, as ITPO records it; null for ITPO staff. */
  organisationName: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, epoch milliseconds. */
  tokenExpires: number;
  user: SessionUser;
}

export interface RefreshResponse {
  accessToken: string;
  tokenExpires: number;
  user: SessionUser;
}

/** What is kept between visits. */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  tokenExpires: number;
}
