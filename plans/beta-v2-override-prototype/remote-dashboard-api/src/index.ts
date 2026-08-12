export interface DashboardStats {
  users: number;
  projects: number;
  revenue: number;
}

export interface DashboardItem {
  id: number;
  name: string;
}

export async function getStats(): Promise<DashboardStats> {
  return { users: 42, projects: 7, revenue: 12345 };
}

export async function listItems(): Promise<DashboardItem[]> {
  return [
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" },
    { id: 3, name: "Gamma" },
  ];
}
