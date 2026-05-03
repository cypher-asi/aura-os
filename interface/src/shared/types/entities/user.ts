export interface ZeroUser {
  user_id: string;
  network_user_id?: string;
  profile_id?: string;
  display_name: string;
  profile_image: string;
  primary_zid: string;
  zero_wallet: string;
  wallets: string[];
  is_zero_pro?: boolean;
  is_access_granted?: boolean;
}

export interface AuthSession {
  user_id: string;
  network_user_id?: string;
  profile_id?: string;
  display_name: string;
  profile_image: string;
  primary_zid: string;
  zero_wallet: string;
  wallets: string[];
  is_zero_pro?: boolean;
  is_access_granted?: boolean;
  zero_pro_refresh_error?: string;
  access_token?: string;
  created_at: string;
  validated_at: string;
}

export interface Follow {
  id: string;
  follower_profile_id: string;
  target_profile_id: string;
  created_at: string;
}
