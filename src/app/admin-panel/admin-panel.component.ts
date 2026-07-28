import {
  Component,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AdminUser, AdminStats } from './admin.service';

type AdminTab = 'overview' | 'users' | 'chat-viewer' | 'shared-chats' | 'settings';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-panel.component.html',
  styleUrls: ['./admin-panel.component.scss']
})
export class AdminPanelComponent implements OnInit, OnDestroy {
  @Output() closePanel = new EventEmitter<void>();

  // ── AUTH STATE ─────────────────────────────────────────────────────────────
  isAuthenticated = false;
  loginId = '';
  loginPassword = '';
  loginError = '';
  loginLoading = false;
  showPassword = false;
  loginShake = false;

  // ── DASHBOARD STATE ────────────────────────────────────────────────────────
  activeTab: AdminTab = 'overview';
  isLoading = false;
  loadError = '';

  // ── DATA ───────────────────────────────────────────────────────────────────
  allUsers: AdminUser[] = [];
  filteredUsers: AdminUser[] = [];
  sharedChats: any[] = [];
  stats: AdminStats = {
    totalUsers: 0,
    totalSharedChats: 0,
    totalMessages: 0,
    totalMemories: 0,
    newUsersToday: 0
  };

  // ── USER TABLE STATE ───────────────────────────────────────────────────────
  userSearch = '';
  userPage = 1;
  usersPerPage = 10;
  selectedUser: AdminUser | null = null;
  selectedUserSessionIndex = 0;
  userDeleteConfirmUid: string | null = null;
  deleteSuccess = '';

  // ── SHARED CHATS STATE ─────────────────────────────────────────────────────
  selectedSharedChat: any | null = null;

  // ── SETTINGS & ANNOUNCEMENT STATE ──────────────────────────────────────────
  broadcastMessage = '';
  broadcastDurationMinutes: number | null = null; // null = indefinite
  customDurationInput = 30;
  broadcastSent = false;
  broadcastLoading = false;
  broadcastStopping = false;
  currentAnnouncement: any = null;
  private announcementUnsub: any = null;

  // ── AUTO LOGOUT ────────────────────────────────────────────────────────────
  private inactivityTimer: any;
  private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Check if admin session is already active (keyboard shortcut reopened the panel)
    if (this.adminService.isAdminSessionActive()) {
      this.isAuthenticated = true;
      this.loadDashboardData();
    }
    this.resetInactivityTimer();

    // Subscribe to live announcements to show status & remaining time in Admin Panel
    this.announcementUnsub = this.adminService.subscribeToAnnouncements((data) => {
      this.currentAnnouncement = data;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    if (this.announcementUnsub) this.announcementUnsub();
  }

  // ── INACTIVITY AUTO-LOGOUT ─────────────────────────────────────────────────
  @HostListener('document:mousemove')
  @HostListener('document:keydown')
  @HostListener('document:click')
  onUserActivity() {
    this.resetInactivityTimer();
  }

  private resetInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (this.isAuthenticated) {
        this.logout();
      }
    }, this.INACTIVITY_TIMEOUT);
  }

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  async submitLogin() {
    if (!this.loginId.trim() || !this.loginPassword.trim()) {
      this.triggerShake('Please enter both Admin ID and Password.');
      return;
    }
    this.loginLoading = true;
    this.loginError = '';
    try {
      const ok = await this.adminService.verifyAdmin(this.loginId.trim(), this.loginPassword);
      if (ok) {
        this.isAuthenticated = true;
        this.loginPassword = '';
        this.loginId = '';
        await this.loadDashboardData();
      } else {
        this.triggerShake('Invalid Admin ID or Password. Try again.');
      }
    } catch {
      this.triggerShake('Authentication error. Please try again.');
    } finally {
      this.loginLoading = false;
      this.cdr.detectChanges();
    }
  }

  private triggerShake(msg: string) {
    this.loginError = msg;
    this.loginShake = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.loginShake = false;
      this.cdr.detectChanges();
    }, 600);
  }

  logout() {
    this.adminService.logoutAdmin();
    this.isAuthenticated = false;
    this.allUsers = [];
    this.sharedChats = [];
    this.selectedUser = null;
    this.selectedSharedChat = null;
    this.loginId = '';
    this.loginPassword = '';
    this.loginError = '';
    this.cdr.detectChanges();
    this.closePanel.emit();
  }

  closeWithoutLogout() {
    this.closePanel.emit();
  }

  // ── DATA LOADING ───────────────────────────────────────────────────────────
  async loadDashboardData() {
    this.isLoading = true;
    this.loadError = '';
    this.cdr.detectChanges();
    try {
      const [users, chats] = await Promise.all([
        this.adminService.getAllUsers(),
        this.adminService.getAllSharedChats()
      ]);
      this.allUsers = users;
      this.sharedChats = chats;
      this.stats = this.adminService.computeStats(users, chats);
      this.applyUserFilter();
    } catch (err) {
      this.loadError = 'Failed to load data. Check Firestore permissions.';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async refreshData() {
    await this.loadDashboardData();
  }

  // ── TAB NAVIGATION ─────────────────────────────────────────────────────────
  switchTab(tab: AdminTab) {
    this.activeTab = tab;
    this.selectedUser = null;
    this.selectedSharedChat = null;
  }

  // ── USER TABLE ─────────────────────────────────────────────────────────────
  applyUserFilter() {
    const q = this.userSearch.toLowerCase().trim();
    if (!q) {
      this.filteredUsers = [...this.allUsers];
    } else {
      this.filteredUsers = this.allUsers.filter(u =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    }
    this.userPage = 1;
  }

  get paginatedUsers(): AdminUser[] {
    const start = (this.userPage - 1) * this.usersPerPage;
    return this.filteredUsers.slice(start, start + this.usersPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredUsers.length / this.usersPerPage);
  }

  get totalPagesArray(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  selectUser(user: AdminUser) {
    this.selectedUser = user;
    this.selectedUserSessionIndex = 0;
    this.activeTab = 'chat-viewer';
  }

  closeUserDetail() {
    this.selectedUser = null;
    this.activeTab = 'users';
  }

  getUserInitial(user: AdminUser): string {
    return (user.displayName || user.email || 'U')[0].toUpperCase();
  }

  formatDate(iso: string): string {
    if (!iso) return 'Never';
    try {
      return new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  }

  getTotalMessagesForUser(user: AdminUser): number {
    return (user.sessions || []).reduce((s: number, sess: any) => s + (sess.messages?.length || 0), 0);
  }

  // ── DELETE USER DATA ───────────────────────────────────────────────────────
  confirmDeleteUser(uid: string) {
    this.userDeleteConfirmUid = uid;
  }

  cancelDelete() {
    this.userDeleteConfirmUid = null;
  }

  async executeDeleteUser() {
    if (!this.userDeleteConfirmUid) return;
    await this.adminService.deleteUserData(this.userDeleteConfirmUid);
    this.allUsers = this.allUsers.map(u =>
      u.uid === this.userDeleteConfirmUid
        ? { ...u, sessions: [], memories: [] }
        : u
    );
    this.deleteSuccess = 'User data cleared successfully.';
    this.userDeleteConfirmUid = null;
    this.applyUserFilter();
    this.cdr.detectChanges();
    setTimeout(() => { this.deleteSuccess = ''; this.cdr.detectChanges(); }, 3000);
  }

  // ── CSV EXPORT ─────────────────────────────────────────────────────────────
  exportCSV() {
    this.adminService.exportUsersAsCSV(this.allUsers);
  }

  // ── SHARED CHATS ───────────────────────────────────────────────────────────
  previewSharedChat(chat: any) {
    this.selectedSharedChat = chat;
  }

  closeSharedChatPreview() {
    this.selectedSharedChat = null;
  }

  // ── BROADCAST ──────────────────────────────────────────────────────────────
  async sendBroadcast() {
    if (!this.broadcastMessage.trim()) return;
    this.broadcastLoading = true;
    this.cdr.detectChanges();

    let duration: number | null = null;
    if (this.broadcastDurationMinutes === -1) {
      duration = Math.max(1, this.customDurationInput || 30);
    } else if (typeof this.broadcastDurationMinutes === 'number') {
      duration = this.broadcastDurationMinutes;
    }

    await this.adminService.broadcastAnnouncement(this.broadcastMessage.trim(), duration);
    this.broadcastLoading = false;
    this.broadcastSent = true;
    this.broadcastMessage = '';
    this.cdr.detectChanges();
    setTimeout(() => { this.broadcastSent = false; this.cdr.detectChanges(); }, 3000);
  }

  async stopBroadcast() {
    this.broadcastStopping = true;
    this.cdr.detectChanges();
    await this.adminService.stopAnnouncement();
    this.broadcastStopping = false;
    this.currentAnnouncement = null;
    this.cdr.detectChanges();
  }

  getRemainingTimeString(expiresAtIso: string): string {
    if (!expiresAtIso) return 'No Expiration';
    const diff = new Date(expiresAtIso).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const mins = Math.floor(diff / (1000 * 60));
    const hrs = Math.floor(mins / 60);
    if (hrs >= 1) {
      const remainingMins = mins % 60;
      return `${hrs}h ${remainingMins}m remaining`;
    }
    return `${mins}m remaining`;
  }

  // ── KEYBOARD SHORTCUT (Ctrl+Shift+A) ──────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      this.closeWithoutLogout();
    }
    if (e.key === 'Escape') {
      if (this.selectedUser) { this.closeUserDetail(); return; }
      if (this.selectedSharedChat) { this.closeSharedChatPreview(); return; }
      if (this.userDeleteConfirmUid) { this.cancelDelete(); return; }
      this.closeWithoutLogout();
    }
  }
}
