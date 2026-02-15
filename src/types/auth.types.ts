export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  name: string;
}

export interface AuthProvider {
  name: string;
  url: string;
  icon?: string;
}

