export interface UserData {
  uid?: string;
  fullName: string;
  nickname: string;
  mobileNumber: string;
  gender: 'male' | 'female' | '';
  weight: number | null;
  age: number | null;
  height: number | null;
  email: string;
  isTrainer: boolean;
  createdAt?: string;
  updatedAt?: string;
  refreshToken?: string;
  refreshTokenExpiry?: string;
}

