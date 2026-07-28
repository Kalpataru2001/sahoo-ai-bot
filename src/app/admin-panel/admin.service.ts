import { Injectable } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ADMIN_CREDENTIALS } from './admin.credentials';

export interface AdminUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  lastLoginAt: string;
  sessions: any[];
  memories: any[];
  preferences: any;
  createdAt?: string;
}

export interface AdminStats {
  totalUsers: number;
  totalSharedChats: number;
  totalMessages: number;
  totalMemories: number;
  newUsersToday: number;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private readonly SESSION_KEY = 'admin_session_token';

  constructor(private authService: AuthService) {}

  // ── ADMIN AUTHENTICATION ─────────────────────────────────────────────────
  async verifyAdmin(id: string, password: string): Promise<boolean> {
    if (id.trim().toLowerCase() !== ADMIN_CREDENTIALS.id.toLowerCase()) return false;
    try {
      const encoded = new TextEncoder().encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
      const hashHex = [...new Uint8Array(hashBuffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
      if (hashHex === ADMIN_CREDENTIALS.passwordHash) {
        // Store session token in sessionStorage (cleared on browser close)
        const token = crypto.randomUUID();
        sessionStorage.setItem(this.SESSION_KEY, token);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Admin: Error during credential verification:', err);
      return false;
    }
  }

  isAdminSessionActive(): boolean {
    return !!sessionStorage.getItem(this.SESSION_KEY);
  }

  logoutAdmin(): void {
    sessionStorage.removeItem(this.SESSION_KEY);
  }

  // ── DATA FETCHING ─────────────────────────────────────────────────────────
  async getAllUsers(): Promise<AdminUser[]> {
    const raw = await this.authService.adminGetAllUsers();
    return raw.map(u => ({
      uid: u.uid || '',
      displayName: u.displayName || 'Unknown',
      email: u.email || '',
      photoURL: u.photoURL || '',
      lastLoginAt: u.lastLoginAt || '',
      sessions: u.sessions || [],
      memories: u.memories || [],
      preferences: u.preferences || {},
      createdAt: u.createdAt || ''
    }));
  }

  async getAllSharedChats(): Promise<any[]> {
    return this.authService.adminGetAllSharedChats();
  }

  async deleteUserData(uid: string): Promise<void> {
    return this.authService.adminDeleteUserData(uid);
  }

  async broadcastAnnouncement(
    message: string, 
    durationMinutes?: number | null,
    customStartAt?: string | null,
    customExpiresAt?: string | null
  ): Promise<void> {
    return this.authService.adminBroadcastAnnouncement(message, durationMinutes, customStartAt, customExpiresAt);
  }

  async stopAnnouncement(): Promise<void> {
    return this.authService.adminStopAnnouncement();
  }

  subscribeToAnnouncements(callback: (data: any) => void) {
    return this.authService.subscribeToAnnouncements(callback);
  }

  // ── STATS AGGREGATION ─────────────────────────────────────────────────────
  computeStats(users: AdminUser[], sharedChats: any[]): AdminStats {
    const todayStr = new Date().toISOString().split('T')[0];

    const totalMessages = users.reduce((sum, u) => {
      const sessionMsgs = (u.sessions || []).reduce(
        (s: number, sess: any) => s + (sess.messages?.length || 0), 0
      );
      return sum + sessionMsgs;
    }, 0);

    const totalMemories = users.reduce((sum, u) => sum + (u.memories?.length || 0), 0);

    const newUsersToday = users.filter(u =>
      u.lastLoginAt && u.lastLoginAt.startsWith(todayStr)
    ).length;

    return {
      totalUsers: users.length,
      totalSharedChats: sharedChats.length,
      totalMessages,
      totalMemories,
      newUsersToday
    };
  }

  // ── EXPORT ────────────────────────────────────────────────────────────────
  exportUsersAsCSV(users: AdminUser[]): void {
    const headers = ['UID', 'Name', 'Email', 'Last Login', 'Sessions', 'Memories'];
    const rows = users.map(u => [
      u.uid,
      `"${u.displayName}"`,
      u.email,
      u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'N/A',
      u.sessions?.length || 0,
      u.memories?.length || 0
    ]);

    const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-companion-users-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
