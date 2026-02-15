import type { AppState } from '../../rootStore';

export const selectUser = (state: AppState) => state.user;

export const selectUserLoading = (state: AppState) => state.userLoading;

export const selectIsAuthenticated = (state: AppState) =>
  !!state.user && state.user.id !== 'guest';