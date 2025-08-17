export interface EventData {
  id?: string;
  name: string;
  date: string; // ISO string format
  picture?: string; // Base64 encoded image string
  createdAt?: string;
  updatedAt?: string;
}
