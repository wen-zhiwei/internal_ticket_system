import { apiRequest } from "./client";

export type UserRole = "agent" | "supervisor";

export type User = {
  id: string;
  name: string;
  role: UserRole;
  created_at: string;
};

export type UserListResponse = {
  items: User[];
};

export function listUsers(): Promise<UserListResponse> {
  return apiRequest<UserListResponse>("/users");
}

export function getCurrentUser(userId: string): Promise<User> {
  return apiRequest<User>("/me", { userId });
}
