import { Component, ElementRef, ViewChild, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { User } from 'firebase/auth';
import { AuthService, UserPreferences, UserMemory } from './services/auth.service';
import { AdminPanelComponent } from './admin-panel/admin-panel.component';
import { AdminService } from './admin-panel/admin.service';

interface Message {
  role: 'user' | 'bot';
  text: string;
}
interface ChatSession {
  id: number;
  title: string;
  messages: Message[];
}


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminPanelComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;

  sessions: ChatSession[] = [];
  currentSessionId: number | null = null;
  isSidebarOpen = false; // For mobile phones
  isSidebarCollapsed = false; // For desktop collapse toggle
  isDarkMode = true;
  userInput: string = '';
  isLoading = false;

  // ── Chat Search ────────────────────────────────────────────────────────────
  chatSearchQuery = '';
  highlightedMsgIndex: number | null = null;

  get filteredSessions(): ChatSession[] {
    const q = this.chatSearchQuery.trim().toLowerCase();
    if (!q) return this.sessions;
    return this.sessions.filter(s => {
      const titleMatch = s.title.toLowerCase().includes(q);
      const msgMatch = s.messages.some(m => m.text.toLowerCase().includes(q));
      return titleMatch || msgMatch;
    });
  }

  /** Returns HTML with the query keyword wrapped in <mark> for highlighting. */
  highlightMatch(text: string): string {
    const q = this.chatSearchQuery.trim();
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  /** Returns a short snippet from the first matching message body. */
  getMatchSnippet(session: ChatSession): string {
    const q = this.chatSearchQuery.trim().toLowerCase();
    if (!q) return '';
    const matchingMsg = session.messages.find(m => m.text.toLowerCase().includes(q));
    if (!matchingMsg) return '';
    const idx = matchingMsg.text.toLowerCase().indexOf(q);
    const start = Math.max(0, idx - 25);
    const raw = matchingMsg.text.substring(start, idx + q.length + 40).replace(/\n/g, ' ');
    return (start > 0 ? '...' : '') + raw + (raw.length < matchingMsg.text.length - start ? '...' : '');
  }
  private currentRequestSub: Subscription | null = null;

  // Auth Variables
  currentUser: User | null = null;
  isAuthModalOpen = false;
  authMode: 'login' | 'register' = 'login';
  authEmail = '';
  authPassword = '';
  authName = '';
  authError = '';
  authLoading = false;

  // Share Feature
  showShareToast = false;
  shareToastMsg = '';

  // Export Feature
  showExportMenu = false;

  // Shared Chat Viewer (when someone opens a ?share=ID link)
  isSharedChatView = false;
  sharedChatData: { title: string; messages: any[]; sharedByName: string; createdAt: string } | null = null;
  sharedChatLoading = false;

  // Voice Mode Variables
  isVoiceMode = false;
  isRecording = false; 
  botIsSpeaking = false;
  currentVoiceText = ''; 
  availableVoices: SpeechSynthesisVoice[] = [];
  isDeleteModalOpen = false;
  chatToDeleteId: number | null = null;

  recognition: any; 
  indianVoice: SpeechSynthesisVoice | null = null;
  
  // Admin Panel
  isAdminPanelOpen = false;

  closeAdminPanel() {
    this.isAdminPanelOpen = false;
    this.cdr.detectChanges();
  }

  // ── Export Chat ─────────────────────────────────────────────────────────────
  toggleExportMenu() {
    this.showExportMenu = !this.showExportMenu;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.export-wrapper')) {
      this.showExportMenu = false;
    }
  }

  getCurrentChatTitle(): string {
    const session = this.sessions.find(s => s.id === this.currentSessionId);
    return session?.title || 'Chat';
  }

  exportAsMarkdown() {
    const title = this.getCurrentChatTitle();
    const date = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
    const personas = this.activePersonas.length > 0
      ? this.activePersonas.map(p => `${p.icon} ${p.name}`).join(', ')
      : '🤖 AI Companion (Default)';

    const lines: string[] = [
      `# AI Companion — Chat Export`,
      ``,
      `**Chat:** ${title}`,
      `**Exported:** ${date}`,
      `**Active Personas:** ${personas}`,
      `**Messages:** ${this.messages.length}`,
      ``,
      `---`,
      ``,
    ];

    this.messages.forEach((msg, i) => {
      const label = msg.role === 'user'
        ? `### 👤 You`
        : `### 🤖 AI Companion`;
      lines.push(label);
      lines.push(msg.text);
      lines.push('');
      if (i < this.messages.length - 1) lines.push('---');
      lines.push('');
    });

    lines.push(`---`);
    lines.push(`*Exported from AI Companion · ${date}*`);

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.md`;
    a.click();
    URL.revokeObjectURL(url);
    this.showExportMenu = false;
  }

  exportAsPDF() {
    const title = this.getCurrentChatTitle();
    const date = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
    const personas = this.activePersonas.length > 0
      ? this.activePersonas.map(p => `${p.icon} ${p.name}`).join(', ')
      : '🤖 AI Companion (Default)';

    const messagesHtml = this.messages.map(msg => {
      const isUser = msg.role === 'user';
      const label = isUser ? '👤 You' : '🤖 AI Companion';
      const cls = isUser ? 'user-msg' : 'bot-msg';
      // Convert markdown-like content to safe HTML for print
      const safeText = msg.text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      return `
        <div class="message ${cls}">
          <div class="msg-label">${label}</div>
          <div class="msg-body">${safeText}</div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title} — AI Companion Export</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1e293b; padding: 32px; max-width: 800px; margin: 0 auto; }
    .export-header { border-bottom: 2px solid #0084ff; padding-bottom: 16px; margin-bottom: 24px; }
    .export-header h1 { font-size: 1.5rem; color: #0084ff; margin-bottom: 6px; }
    .export-meta { font-size: 0.82rem; color: #64748b; display: flex; gap: 16px; flex-wrap: wrap; }
    .export-meta span { background: #f1f5f9; padding: 3px 10px; border-radius: 20px; }
    .messages { display: flex; flex-direction: column; gap: 16px; }
    .message { padding: 14px 16px; border-radius: 12px; page-break-inside: avoid; }
    .user-msg { background: #eff6ff; border-left: 4px solid #0084ff; }
    .bot-msg { background: #f8fafc; border-left: 4px solid #10b981; }
    .msg-label { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 6px; }
    .user-msg .msg-label { color: #0084ff; }
    .bot-msg .msg-label { color: #10b981; }
    .msg-body { font-size: 0.92rem; line-height: 1.65; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.85em; }
    strong { font-weight: 700; }
    .export-footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 0.78rem; color: #94a3b8; text-align: center; }
    @media print {
      body { padding: 16px; }
      .message { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="export-header">
    <h1>📤 ${title}</h1>
    <div class="export-meta">
      <span>📅 ${date}</span>
      <span>💬 ${this.messages.length} messages</span>
      <span>${personas}</span>
    </div>
  </div>
  <div class="messages">${messagesHtml}</div>
  <div class="export-footer">Exported from AI Companion · ${date}</div>
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
    this.showExportMenu = false;
  }

  // Ctrl+Shift+A: toggle panel within the same session (after first login via Sign In form)
  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      const hasSession = !!sessionStorage.getItem('admin_session_token');
      if (hasSession) {
        this.isAdminPanelOpen = !this.isAdminPanelOpen;
        this.cdr.detectChanges();
      }
    }
  }

  messages: Message[] = [
    { role: 'bot', text: 'Namaste! Voice Mode is ready. Click the big floating mic to try it!' }
  ];

  // --- USER PREFERENCES / SETTINGS & MEMORY ---
  isSettingsModalOpen = false;
  activeSettingsTab: 'preferences' | 'memories' = 'preferences';
  settingsSavedMsg = false;
  userPrefs: UserPreferences = {
    callingName: '',
    occupation: '',
    tone: 'Friendly & Casual',
    interests: '',
    persona: 'default',
    personas: ['default']
  };

  // ── AI Personas ─────────────────────────────────────────────────────────────
  readonly personas = [
    {
      id: 'default',
      icon: '🤖',
      name: 'AI Companion',
      desc: 'Balanced & helpful — the classic experience',
      prompt: ''
    },
    {
      id: 'coding',
      icon: '💻',
      name: 'Coding Assistant',
      desc: 'Technical, precise & code-focused with examples',
      prompt: 'You are a highly skilled Coding Assistant. Focus on clean code, debugging, and best practices. Always provide runnable code examples when relevant. Be precise, efficient, and explain technical concepts clearly. Prefer showing code over long explanations.'
    },
    {
      id: 'study',
      icon: '📚',
      name: 'Study Buddy',
      desc: 'Patient teacher who breaks complex topics down',
      prompt: 'You are a patient and encouraging Study Buddy. Break down complex topics into simple, digestible steps. Use analogies, real-world examples, and structured explanations. Celebrate the user\'s curiosity and make learning feel engaging and approachable.'
    },
    {
      id: 'career',
      icon: '💼',
      name: 'Career Coach',
      desc: 'Strategic, professional & goal-oriented advice',
      prompt: 'You are an experienced Career Coach. Provide strategic and actionable advice on career growth, job searching, interviews, networking, and professional development. Be motivating, realistic, and help the user clarify and achieve their career goals.'
    },
    {
      id: 'creative',
      icon: '🎨',
      name: 'Creative Writer',
      desc: 'Imaginative, expressive & story-driven partner',
      prompt: 'You are a creative and imaginative writing partner. Help with storytelling, creative writing, poetry, worldbuilding, and brainstorming. Be expressive and vivid in language, suggest creative twists, and inspire the user to bring their ideas to life.'
    },
    {
      id: 'wellness',
      icon: '🧘',
      name: 'Wellness Guide',
      desc: 'Calm, empathetic & mindfulness-focused support',
      prompt: 'You are a calm and empathetic Wellness Guide. Focus on mental health, mindfulness, stress management, and healthy habits. Speak gently and non-judgmentally, validate feelings, and offer practical self-care and well-being suggestions.'
    }
  ];

  /** Returns array of currently selected persona IDs (migrating legacy single persona if needed). */
  getSelectedPersonaIds(): string[] {
    if (Array.isArray(this.userPrefs.personas) && this.userPrefs.personas.length > 0) {
      return this.userPrefs.personas;
    }
    if (this.userPrefs.persona && this.userPrefs.persona !== 'default') {
      return [this.userPrefs.persona];
    }
    return ['default'];
  }

  /** Check if a persona ID is currently selected. */
  isPersonaSelected(id: string): boolean {
    const ids = this.getSelectedPersonaIds();
    return ids.includes(id);
  }

  /** Toggle a persona ON or OFF. */
  togglePersona(id: string) {
    let ids = [...this.getSelectedPersonaIds()];

    if (id === 'default') {
      // Selecting default clears all other personas
      this.userPrefs.personas = ['default'];
      this.userPrefs.persona = 'default';
      return;
    }

    // Remove 'default' when a specific persona is clicked
    ids = ids.filter(pId => pId !== 'default');

    if (ids.includes(id)) {
      ids = ids.filter(pId => pId !== id);
    } else {
      ids.push(id);
    }

    if (ids.length === 0) {
      ids = ['default'];
    }

    this.userPrefs.personas = ids;
    this.userPrefs.persona = ids.join('+');
  }

  /** Returns array of active non-default Persona objects. */
  get activePersonas() {
    const ids = this.getSelectedPersonaIds();
    if (ids.includes('default') && ids.length === 1) return [];
    return this.personas.filter(p => p.id !== 'default' && ids.includes(p.id));
  }

  get activePersona() {
    const id = this.userPrefs.persona || 'default';
    return this.personas.find(p => p.id === id) ?? this.personas[0];
  }
  userMemories: UserMemory[] = [];
  newMemoryInput = '';
  isExtractingMemories = false;

  getUserFullName(): string {
    return this.authService.getUserDisplayName(this.currentUser);
  }

  getUserFirstName(): string {
    if (this.userPrefs.callingName && this.userPrefs.callingName.trim()) {
      return this.userPrefs.callingName.trim();
    }
    const fullName = this.getUserFullName();
    if (!fullName || fullName === 'User') return 'Sahoo';
    return fullName.split(' ')[0];
  }

  async loadUserPreferences(user?: User | null) {
    const targetUser = user !== undefined ? user : this.currentUser;
    if (targetUser) {
      const cloudPrefs = await this.authService.getUserPreferences(targetUser.uid);
      if (cloudPrefs) {
        this.userPrefs = { ...cloudPrefs };
      }
      this.userMemories = await this.authService.getMemories(targetUser.uid);
      this.cdr.detectChanges();
      return;
    }
    const local = localStorage.getItem('ai_companion_user_prefs');
    if (local) {
      try {
        this.userPrefs = JSON.parse(local);
      } catch (e) { }
    }
    const localMemories = localStorage.getItem('ai_companion_user_memories');
    if (localMemories) {
      try {
        this.userMemories = JSON.parse(localMemories);
      } catch (e) { }
    }
  }

  async openSettingsModal() {
    await this.loadUserPreferences();
    if (!this.userPrefs.callingName && this.currentUser) {
      this.userPrefs.callingName = this.authService.getUserDisplayName(this.currentUser);
    }
    this.activeSettingsTab = 'preferences';
    this.settingsSavedMsg = false;
    this.isSettingsModalOpen = true;
    this.cdr.detectChanges();
  }

  closeSettingsModal() {
    this.isSettingsModalOpen = false;
    this.settingsSavedMsg = false;
  }

  async saveSettings() {
    localStorage.setItem('ai_companion_user_prefs', JSON.stringify(this.userPrefs));
    if (this.currentUser) {
      await this.authService.saveUserPreferences(this.currentUser.uid, this.userPrefs);
    }
    this.settingsSavedMsg = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.settingsSavedMsg = false;
      this.isSettingsModalOpen = false;
      this.cdr.detectChanges();
    }, 1200);
  }

  async addManualMemory() {
    const fact = this.newMemoryInput.trim();
    if (!fact) return;

    if (this.currentUser) {
      this.userMemories = await this.authService.addMemories(this.currentUser.uid, [fact]);
    } else {
      const newMem: UserMemory = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        fact,
        addedAt: new Date().toISOString(),
        source: 'manual'
      };
      this.userMemories = [...this.userMemories, newMem].slice(-50);
      localStorage.setItem('ai_companion_user_memories', JSON.stringify(this.userMemories));
    }
    this.newMemoryInput = '';
    this.cdr.detectChanges();
  }

  async deleteMemoryItem(memoryId: string) {
    if (this.currentUser) {
      this.userMemories = await this.authService.deleteMemory(this.currentUser.uid, memoryId);
    } else {
      this.userMemories = this.userMemories.filter(m => m.id !== memoryId);
      localStorage.setItem('ai_companion_user_memories', JSON.stringify(this.userMemories));
    }
    this.cdr.detectChanges();
  }

  async clearAllMemories() {
    if (confirm('Are you sure you want to clear all stored memories about you?')) {
      if (this.currentUser) {
        await this.authService.clearAllMemories(this.currentUser.uid);
        this.userMemories = [];
      } else {
        this.userMemories = [];
        localStorage.removeItem('ai_companion_user_memories');
      }
      this.cdr.detectChanges();
    }
  }

  private extractMemoriesFromConversation(conversationSnippet: string, userText: string) {
    if (!conversationSnippet || conversationSnippet.trim().length < 15) return;

    // Smart Intent Filter: Only call memory extraction if userText contains personal statement keywords!
    // This prevents burning 50% of Gemini API quota on general questions like "what is LSP" or "how to fix bug".
    const lowerText = userText.toLowerCase();
    const personalKeywords = [
      'i am', 'i work', 'i live', 'i love', 'i like', 'my name', 'i prefer', 
      'i use', 'i study', 'i built', 'my job', 'my hobby', 'my favorite', 
      'i\'m', 'my name is', 'mera', 'meri', 'mujhe', 'rehta', 'pasand', 'kam karta',
      'i have', 'i want', 'i plan', 'my email', 'my location', 'i feel', 'i hate'
    ];
    const isPersonalStatement = personalKeywords.some(kw => lowerText.includes(kw));

    if (!isPersonalStatement) {
      return; // Skip memory extraction call for general questions
    }

    this.isExtractingMemories = true;
    const existingFactTexts = this.userMemories.map(m => m.fact);

    this.http.post<{ memories: string[] }>('https://sahoo-ai-proxy-us.onrender.com/api/extract-memories', {
      conversation: conversationSnippet,
      existingMemories: existingFactTexts
    }).subscribe({
      next: async (res) => {
        this.isExtractingMemories = false;
        if (res && res.memories && res.memories.length > 0) {
          if (this.currentUser) {
            this.userMemories = await this.authService.addMemories(this.currentUser.uid, res.memories);
          } else {
            const newMems: UserMemory[] = res.memories.map(fact => ({
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              fact,
              addedAt: new Date().toISOString(),
              source: 'auto'
            }));
            this.userMemories = [...this.userMemories, ...newMems].slice(-50);
            localStorage.setItem('ai_companion_user_memories', JSON.stringify(this.userMemories));
          }
          this.cdr.detectChanges();
        }
      },
      error: () => {
        this.isExtractingMemories = false;
      }
    });
  }

  constructor(
    private http: HttpClient, 
    public cdr: ChangeDetectorRef, 
    private sanitizer: DomSanitizer,
    public authService: AuthService,
    private adminService: AdminService
  ) {}

  // Cache for rendered markdown HTML to prevent DOM node recreation & preserve text selection!
  private markdownCache = new Map<string, SafeHtml>();

  renderMarkdown(text: string): SafeHtml {
    if (!text) return '';
    if (this.markdownCache.has(text)) {
      return this.markdownCache.get(text)!;
    }
    try {
      const html = marked.parse(text, { breaks: true }) as string;
      const safe = this.sanitizer.bypassSecurityTrustHtml(html);
      this.markdownCache.set(text, safe);
      return safe;
    } catch (e) {
      const safeFallback = this.sanitizer.bypassSecurityTrustHtml(text);
      this.markdownCache.set(text, safeFallback);
      return safeFallback;
    }
  }

  /**
   * Same as renderMarkdown but wraps every occurrence of the search query
   * inside <mark class="search-mark"> tags — only in text nodes, never inside
   * HTML tag attributes (uses a negative-lookahead to skip inside < ... >).
   * Not cached — only used on the single highlighted message at a time.
   */
  renderMarkdownWithHighlight(text: string): SafeHtml {
    if (!text) return '';
    const q = this.chatSearchQuery.trim();
    if (!q) return this.renderMarkdown(text);
    try {
      const html = marked.parse(text, { breaks: true }) as string;
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Negative lookahead: don't match inside HTML tag bodies (between < and >)
      const highlighted = html.replace(
        new RegExp(`(${escaped})(?![^<]*>)`, 'gi'),
        '<mark class="search-mark">$1</mark>'
      );
      return this.sanitizer.bypassSecurityTrustHtml(highlighted);
    } catch (e) {
      return this.renderMarkdown(text);
    }
  }

  toggleSidebarCollapse() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  toggleMobileSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  // PWA Mobile Banner Variables
  deferredInstallPrompt: any = null;
  showInstallBanner = false;
  isIosDevice = false;
  showIosInstructions = false;

  // Announcement Banner
  activeAnnouncement: { message: string; createdAt: string; startAt?: string | null; expiresAt?: string | null } | null = null;
  isAnnouncementDismissed = false;
  private announcementStartTimer: any = null;
  private announcementExpiryTimer: any = null;

  dismissAnnouncement() {
    this.isAnnouncementDismissed = true;
    this.cdr.detectChanges();
  }

  ngOnInit() {
    this.initSpeechRecognition(); 
    this.loadVoices();
    this.initPwaInstallPrompt();
    // Check if this is a shared chat link (?share=ID)
    this.checkSharedChatOnLoad();

    // Subscribe to broadcast announcements from Admin Panel
    this.authService.subscribeToAnnouncements((data) => {
      if (this.announcementStartTimer) clearTimeout(this.announcementStartTimer);
      if (this.announcementExpiryTimer) clearTimeout(this.announcementExpiryTimer);
      this.announcementStartTimer = null;
      this.announcementExpiryTimer = null;

      if (data && data.message) {
        const now = Date.now();
        const startMs = data.startAt ? new Date(data.startAt).getTime() - now : 0;
        const expiryMs = data.expiresAt ? new Date(data.expiresAt).getTime() - now : Infinity;

        // Has already expired?
        if (expiryMs <= 0) {
          this.activeAnnouncement = null;
          this.cdr.detectChanges();
          return;
        }

        // Scheduled for future?
        if (startMs > 0) {
          this.activeAnnouncement = null;
          // Set timer to show when startAt time arrives
          this.announcementStartTimer = setTimeout(() => {
            this.activeAnnouncement = data;
            this.isAnnouncementDismissed = false;
            this.cdr.detectChanges();
          }, startMs);
        } else {
          // Live right now
          if (!this.activeAnnouncement || this.activeAnnouncement.message !== data.message) {
            this.isAnnouncementDismissed = false;
          }
          this.activeAnnouncement = data;
        }

        // Set timer to hide when expiresAt time arrives
        if (expiryMs !== Infinity && expiryMs > 0) {
          this.announcementExpiryTimer = setTimeout(() => {
            this.activeAnnouncement = null;
            this.cdr.detectChanges();
          }, expiryMs);
        }
      } else {
        this.activeAnnouncement = null;
      }
      this.cdr.detectChanges();
    });

    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoices();
    };

    // Firebase Auth State Listener
    this.authService.currentUser$.subscribe(async (user) => {
      this.currentUser = user;
      await this.loadUserPreferences(user);
      if (user) {
        // Guarantee user metadata (displayName, email, photoURL) is saved in Firestore document
        await this.authService.saveUserProfile(user);

        // Fetch User's Firestore Sessions
        const cloudSessions = await this.authService.getUserSessions(user.uid);
        if (cloudSessions && cloudSessions.length > 0) {
          this.sessions = cloudSessions;
          this.selectChat(this.sessions[0].id);
        } else {
          // If new user, create a clean, private conversation for this user
          const initialSession: ChatSession = {
            id: Date.now(),
            title: 'New Conversation',
            messages: [
              { role: 'bot', text: `Namaste ${this.authService.getUserDisplayName(user)}! What is on your mind today?` }
            ]
          };
          this.sessions = [initialSession];
          this.selectChat(initialSession.id);
          await this.authService.saveUserSessions(user.uid, this.sessions, user);
        }
      } else {
        this.sessions = [];
        const savedSessions = localStorage.getItem('veda_sessions');
        if (savedSessions) {
          this.sessions = JSON.parse(savedSessions);
          if (this.sessions.length > 0) {
            this.selectChat(this.sessions[0].id);
          } else {
            this.createNewChat();
          }
        } else {
          this.createNewChat(); 
        }
      }
      this.cdr.detectChanges();
    });
  }

  showInstructionsBanner = false;

  initPwaInstallPrompt() {
    // Force clear dismissal flags so install prompt is always accessible on mobile
    localStorage.removeItem('pwa_banner_dismissed');
    sessionStorage.removeItem('pwa_banner_dismissed');

    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isSmallScreen = window.innerWidth <= 768;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    this.isIosDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if ((isMobileDevice || isSmallScreen) && !isStandalone) {
      window.addEventListener('beforeinstallprompt', (e: any) => {
        e.preventDefault();
        this.deferredInstallPrompt = e;
        if (window.innerWidth <= 768) {
          this.showInstallBanner = true;
          this.cdr.detectChanges();
        }
      });

      // Mobile fallback prompt
      setTimeout(() => {
        if (window.innerWidth <= 768) {
          this.showInstallBanner = true;
          this.cdr.detectChanges();
        }
      }, 1000);
    }
  }

  triggerInstallFromSidebar() {
    this.isSidebarOpen = false;
    this.showInstallBanner = true;
    this.installPwa();
  }

  async installPwa() {
    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      const choiceResult = await this.deferredInstallPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        this.dismissInstallBanner();
      }
      this.deferredInstallPrompt = null;
    } else if (this.isIosDevice) {
      this.showIosInstructions = true;
    } else {
      this.showInstructionsBanner = true;
    }
  }

  dismissInstallBanner() {
    this.showInstallBanner = false;
    this.showIosInstructions = false;
    this.showInstructionsBanner = false;
  }

  scrollToBottom(): void {
    try {
      if (this.myScrollContainer && this.myScrollContainer.nativeElement) {
        this.myScrollContainer.nativeElement.scrollTop = this.myScrollContainer.nativeElement.scrollHeight;
      }
    } catch(err) { }
  }
  // --- SESSION MANAGEMENT ---
  createNewChat() {
    const newId = Date.now();
    const userName = this.getUserFirstName();
    const newSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: [{ role: 'bot', text: `Namaste ${userName}! What is on your mind?` }]
    };
    
    // Add to the top of the list
    this.sessions.unshift(newSession);
    
    // Keep only the latest 10 chats!
    if (this.sessions.length > 10) {
      this.sessions.pop(); 
    }
    
    this.selectChat(newId);
  }

  selectChat(id: number) {
    this.currentSessionId = id;
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      this.messages = session.messages;
    }
    this.highlightedMsgIndex = null;
    this.isSidebarOpen = false; // Auto-close sidebar on mobile after clicking
    this.saveChats();
    setTimeout(() => this.scrollToBottom(), 60);
  }

  /** Called from search results — switches chat AND scrolls/highlights the matching message. */
  selectChatFromSearch(id: number) {
    const q = this.chatSearchQuery.trim().toLowerCase();

    // No active search — behave like a normal chat switch
    if (!q) {
      this.selectChat(id);
      return;
    }

    // Switch to the session
    this.currentSessionId = id;
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      this.messages = session.messages;
    }
    this.highlightedMsgIndex = null;
    this.isSidebarOpen = false;
    this.saveChats();
    this.cdr.detectChanges();

    // Find the first message index that matches the query
    const matchIdx = this.messages.findIndex(m => m.text.toLowerCase().includes(q));

    if (matchIdx === -1) {
      // No message body match — title-only match, just scroll to bottom
      setTimeout(() => this.scrollToBottom(), 60);
      return;
    }

    // Wait for Angular to render the new messages, then scroll & highlight
    setTimeout(() => {
      const msgEl = document.getElementById('msg-' + matchIdx);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      this.highlightedMsgIndex = matchIdx;
      this.cdr.detectChanges();

      // Clear highlight after 2.5s
      setTimeout(() => {
        this.highlightedMsgIndex = null;
        this.cdr.detectChanges();
      }, 2500);
    }, 80);
  }

  saveChats() {
    const session = this.sessions.find(s => s.id === this.currentSessionId);
    if (session) {
      session.messages = this.messages;
      
      // Auto-generate a title based on your first message!
      if (session.title === 'New Conversation' && this.messages.length > 1) {
        const firstUserMsg = this.messages.find(m => m.role === 'user');
        if (firstUserMsg) {
          session.title = firstUserMsg.text.substring(0, 25) + '...';
        }
      }
    }
    localStorage.setItem('veda_sessions', JSON.stringify(this.sessions));
    if (this.currentUser) {
      this.authService.saveUserSessions(this.currentUser.uid, this.sessions, this.currentUser);
    }
  }

  deleteChat(event: Event, id: number) {
    // CRITICAL: This stops the click from also triggering 'selectChat'
    event.stopPropagation(); 

    // 1. Remove the chat from our array
    this.sessions = this.sessions.filter(s => s.id !== id);

    // 2. Save the updated list to local storage
    localStorage.setItem('veda_sessions', JSON.stringify(this.sessions));

    // 3. Smart Handling: If you just deleted the chat you were currently reading...
    if (this.currentSessionId === id) {
      if (this.sessions.length > 0) {
        // Open the newest available chat
        this.selectChat(this.sessions[0].id); 
      } else {
        // If that was the last chat, create a brand new one!
        this.createNewChat(); 
      }
    }
  }

  openDeleteModal(event: Event, id: number) {
    event.stopPropagation(); // Stop from clicking the chat behind it
    this.chatToDeleteId = id;
    this.isDeleteModalOpen = true;
  }

  cancelDelete() {
    this.isDeleteModalOpen = false;
    this.chatToDeleteId = null;
  }

  confirmDelete() {
    if (this.chatToDeleteId === null) return;

    const id = this.chatToDeleteId;
    
    // 1. Remove from array
    this.sessions = this.sessions.filter(s => s.id !== id);

    // 2. Save to storage
    localStorage.setItem('veda_sessions', JSON.stringify(this.sessions));

    // 3. Smart Handling for active chats
    if (this.currentSessionId === id) {
      if (this.sessions.length > 0) {
        this.selectChat(this.sessions[0].id); 
      } else {
        this.createNewChat(); 
      }
    }

    // 4. Close the modal
    this.cancelDelete();
  }

  toggleTheme() {
    const layoutEl = document.querySelector('.app-layout') as HTMLElement;
    if (layoutEl) {
      layoutEl.classList.add('theme-transitioning');
      this.isDarkMode = !this.isDarkMode;
      // Remove the transitioning class after animation completes (400ms > 350ms CSS transition)
      setTimeout(() => layoutEl.classList.remove('theme-transitioning'), 400);
    } else {
      this.isDarkMode = !this.isDarkMode;
    }
  }

  // --- NEW: VOICE MODE CONTROLS ---
  enterVoiceMode() {
    this.isVoiceMode = true;
    this.currentVoiceText = 'Listening...';
    this.startListening();
  }

  closeVoiceMode() {
    this.isVoiceMode = false;
    this.isRecording = false;
    this.botIsSpeaking = false;
    if (this.recognition) this.recognition.stop();
    window.speechSynthesis.cancel();
  }

  // --- SPEECH RECOGNITION (EARS) ---
  initSpeechRecognition() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn("Speech Recognition is not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    
    // Force the mic to stop listening when you pause
    this.recognition.continuous = false;
    
    // CRITICAL FIX: Set to true so we can process chunks of speech live
    this.recognition.interimResults = true;

    this.recognition.onstart = () => {
      this.isRecording = true;
      this.botIsSpeaking = false;
      this.currentVoiceText = 'Listening...';
      this.cdr.detectChanges(); 
    };

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      // Loop through all speech chunks to separate what is final vs what is still being spoken
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      // Update the UI live as you are speaking (so it feels responsive)
      if (interimTranscript) {
        this.userInput = interimTranscript;
        this.currentVoiceText = interimTranscript;
        this.cdr.detectChanges();
      }

      // Once the browser confirms the sentence is done, auto-send it!
      if (finalTranscript) {
        this.userInput = finalTranscript;
        this.currentVoiceText = finalTranscript; // Show final text
        this.isRecording = false;                // Turn off mic animation
        this.cdr.detectChanges(); 
        
        this.sendMessage(); // Send to Gemini instantly
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        this.isRecording = false;
        if (this.isVoiceMode) this.currentVoiceText = 'Tap the orb to speak...';
        this.cdr.detectChanges(); 
        return; 
      }
      console.error("Speech recognition error:", event.error);
      this.isRecording = false;
      this.cdr.detectChanges(); 
    };

    this.recognition.onend = () => {
      // Failsafe to ensure UI resets when the mic fully powers down
      this.isRecording = false;
      this.cdr.detectChanges(); 
    };
  }

  startListening() {
    if (this.recognition && !this.isRecording) {
      window.speechSynthesis.cancel(); // Stop bot if you interrupt it
      this.recognition.start();
    }
  }


  loadVoices() {
    this.availableVoices = window.speechSynthesis.getVoices();
  }

  speak(text: string) {
    if (!window.speechSynthesis) {
      console.warn("Your browser does not support voice output.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const isOdia = /[\u0B00-\u0B7F]/.test(text);   
    const isHindi = /[\u0900-\u097F]/.test(text);  

    let targetLang = 'en-IN'; 

    if (isOdia) {
      targetLang = 'or-IN';
    } else if (isHindi) {
      targetLang = 'hi-IN';
    }
    
    let matchedVoice = this.availableVoices.find(v => v.lang === targetLang);
    if (!matchedVoice) {
      matchedVoice = this.availableVoices.find(v => v.lang === 'hi-IN') 
                  || this.availableVoices.find(v => v.lang === 'en-IN');
    }

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }
    utterance.lang = targetLang;
    utterance.rate = 0.95;  
    utterance.pitch = 1.05; 

    window.speechSynthesis.speak(utterance);
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      if (isMobile) {
        // On mobile keyboards, Enter key (↵) inserts a new line naturally
        // User taps the blue Send button (✈) to send message
        return;
      }
      if (!event.shiftKey) {
        // On desktop, Enter sends message, Shift+Enter inserts newline
        event.preventDefault();
        this.sendMessage();
      }
    }
  }

  autoResizeTextarea(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
    }
  }

  sendMessage() {
    if (!this.userInput.trim() || this.isLoading) return;

    // Enforce 1-chat limit for unauthenticated guests!
    if (!this.currentUser) {
      const userMessageCount = this.messages.filter(m => m.role === 'user').length;
      if (userMessageCount >= 1) {
        this.authError = 'You have used your 1 free guest chat! Please sign in to continue chatting and save your history.';
        this.isAuthModalOpen = true;
        return;
      }
    }

    const userText = this.userInput;
    this.messages.push({ role: 'user', text: userText });
    this.saveChats();
    this.userInput = '';
    this.isLoading = true;

    // Reset textarea height after sending
    setTimeout(() => {
      const textarea = document.querySelector('.input-wrapper textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = 'auto';
      }
      this.scrollToBottom();
    }, 60);

    if (this.isVoiceMode) {
      this.currentVoiceText = 'Thinking...';
    }

    this.dispatchToGemini(userText);
  }

  /** Shared HTTP core used by sendMessage, saveAndResendMessage, and regenerateLastResponse. */
  private dispatchToGemini(userText: string) {
    const userName = this.getUserFirstName();
    const userFullName = this.getUserFullName();

    let geminiHistory = this.messages
      .filter(m => m.text !== 'Backend is sleeping!' && m.text !== 'Connection Error.')
      .slice(0, -1)
      .slice(-10)
      .map(m => ({
        role: m.role === 'bot' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }));
    while (geminiHistory.length > 0 && geminiHistory[0].role === 'model') {
      geminiHistory.shift();
    }

    const memoryFacts = this.userMemories.map(m => m.fact);
    const activePersonas = this.activePersonas;
    let personaContext = '';

    if (activePersonas.length === 1) {
      personaContext = activePersonas[0].prompt;
    } else if (activePersonas.length > 1) {
      personaContext = `You are acting as a hybrid assistant combining the following roles simultaneously:\n` +
        activePersonas.map(p => `- ${p.name}: ${p.prompt}`).join('\n');
    }

    const systemContext = [
      `The user's name is ${userName}. Address them as ${userName} naturally in conversation when appropriate.`,
      personaContext
    ].filter(Boolean).join('\n\n');

    this.currentRequestSub = this.http.post<{reply: string}>('https://sahoo-ai-proxy-us.onrender.com/api/chat', {
      message: userText,
      history: geminiHistory,
      userName: this.userPrefs.callingName || userName,
      userFirstName: userName,
      userFullName: userFullName,
      occupation: this.userPrefs.occupation || '',
      tone: this.userPrefs.tone || 'friendly',
      memories: memoryFacts,
      systemContext
    }).subscribe({
      next: (response) => {
        this.currentRequestSub = null;
        this.messages.push({ role: 'bot', text: response.reply });
        this.saveChats();
        this.isLoading = false;
        setTimeout(() => this.scrollToBottom(), 60);
        if (this.isVoiceMode) {
          this.speak(response.reply);
        }
        // Trigger automatic memory extraction (filtered for personal statements)
        const snippet = `User: ${userText}\nAI: ${response.reply}`;
        this.extractMemoriesFromConversation(snippet, userText);
      },
      error: (err) => {
        this.currentRequestSub = null;
        const errorMessage = err.error?.error || 'My backend seems to be sleeping!';
        this.messages.push({ role: 'bot', text: errorMessage });
        this.isLoading = false;
        if (this.isVoiceMode) {
          this.currentVoiceText = 'Connection Error.';
        }
        this.speak(errorMessage);
      }
    });
  }

  // --- AUTHENTICATION MODAL CONTROLS ---
  openAuthModal(mode: 'login' | 'register' = 'login') {
    this.authMode = mode;
    this.authError = '';
    this.authEmail = '';
    this.authPassword = '';
    this.authName = '';
    this.isAuthModalOpen = true;
  }

  closeAuthModal() {
    this.isAuthModalOpen = false;
    this.authError = '';
  }

  async loginWithGoogle() {
    this.authLoading = true;
    this.authError = '';
    try {
      await this.authService.loginWithGoogle();
      this.closeAuthModal();
    } catch (err: any) {
      console.error('Google Sign In Error:', err);
      this.authError = err.message || 'Failed to sign in with Google.';
    } finally {
      this.authLoading = false;
      this.cdr.detectChanges();
    }
  }

  async submitEmailAuth() {
    if (!this.authEmail || !this.authPassword) {
      this.authError = 'Please enter both email and password.';
      return;
    }
    this.authLoading = true;
    this.authError = '';
    try {
      // ── Admin credential check (runs before Firebase Auth) ──────────────
      // If user types the admin ID + password, open Admin Panel directly.
      if (this.authMode === 'login') {
        const isAdmin = await this.adminService.verifyAdmin(
          this.authEmail.trim(),
          this.authPassword
        );
        if (isAdmin) {
          this.closeAuthModal();
          this.isAdminPanelOpen = true;
          this.cdr.detectChanges();
          return;
        }
      }
      // ── Normal Firebase Auth ─────────────────────────────────────────────
      if (this.authMode === 'login') {
        await this.authService.loginWithEmail(this.authEmail, this.authPassword);
      } else {
        await this.authService.registerWithEmail(this.authEmail, this.authPassword, this.authName);
      }
      this.closeAuthModal();
    } catch (err: any) {
      console.error('Email Auth Error:', err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        this.authError = 'Invalid email or password. Please try again.';
      } else if (err.code === 'auth/email-already-in-use') {
        this.authError = 'An account with this email already exists. Try signing in.';
      } else if (err.code === 'auth/weak-password') {
        this.authError = 'Password should be at least 6 characters long.';
      } else {
        this.authError = err.message || 'Authentication failed.';
      }
    } finally {
      this.authLoading = false;
      this.cdr.detectChanges();
    }
  }

  // --- EDIT & REGENERATE ---
  editingMessageIndex: number | null = null;
  editingMessageText = '';

  stopGeneration() {
    if (this.currentRequestSub) {
      this.currentRequestSub.unsubscribe();
      this.currentRequestSub = null;
    }
    this.isLoading = false;
    // Remove the last user message that was sent (since the request is cancelled)
    // and put it back into the input box so they can fix and resend
    const lastUserMsgIndex = this.messages.map(m => m.role).lastIndexOf('user');
    if (lastUserMsgIndex !== -1) {
      this.userInput = this.messages[lastUserMsgIndex].text;
      this.messages = this.messages.slice(0, lastUserMsgIndex);
      this.saveChats();
    }
    this.cdr.detectChanges();
    // Restore textarea height
    setTimeout(() => {
      const textarea = document.querySelector('.input-wrapper textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
        textarea.focus();
      }
    }, 30);
  }

  startEditMessage(index: number) {
    if (this.isLoading) return;
    this.editingMessageIndex = index;
    this.editingMessageText = this.messages[index].text;
    this.cdr.detectChanges();
    // Focus textarea on next tick
    setTimeout(() => {
      const el = document.getElementById('edit-textarea-' + index) as HTMLTextAreaElement;
      if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    }, 30);
  }

  cancelEditMessage() {
    this.editingMessageIndex = null;
    this.editingMessageText = '';
    this.cdr.detectChanges();
  }

  saveAndResendMessage(index: number) {
    const newText = this.editingMessageText.trim();
    if (!newText || this.isLoading) return;

    // Remove everything from the edited message onwards
    this.messages = this.messages.slice(0, index);
    this.editingMessageIndex = null;
    this.editingMessageText = '';

    // Re-push the user message with edited text, then dispatch to Gemini
    this.messages.push({ role: 'user', text: newText });
    this.saveChats();
    this.isLoading = true;
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 60);
    this.dispatchToGemini(newText);
  }

  regenerateLastResponse() {
    if (this.isLoading) return;
    // Find the last bot message and remove it
    const lastBotIndex = this.messages.map(m => m.role).lastIndexOf('bot');
    if (lastBotIndex === -1) return;
    this.messages = this.messages.slice(0, lastBotIndex);

    // The last remaining message should be the user message to re-send
    const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;

    this.saveChats();
    this.isLoading = true;
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 60);
    this.dispatchToGemini(lastUserMsg.text);
  }

  // --- COPY TEXT FUNCTIONALITY ---
  copiedMsgIndex: number | null = null;

  copyMessageText(text: string, index: number) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedMsgIndex = index;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.copiedMsgIndex = null;
          this.cdr.detectChanges();
        }, 2000);
      }).catch(() => this.fallbackCopyText(text, index));
    } else {
      this.fallbackCopyText(text, index);
    }
  }

  private fallbackCopyText(text: string, index: number) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      this.copiedMsgIndex = index;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.copiedMsgIndex = null;
        this.cdr.detectChanges();
      }, 2000);
    } catch (err) { }
    document.body.removeChild(textarea);
  }

  // --- SHARING FEATURE ---
  private showShareToastMsg(msg: string) {
    this.shareToastMsg = msg;
    this.showShareToast = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.showShareToast = false;
      this.cdr.detectChanges();
    }, 2500);
  }

  private copyToClipboard(text: string) {
    try {
      navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  async shareChat() {
    const session = this.sessions.find(s => s.id === this.currentSessionId);
    const sessionTitle = session?.title || 'AI Companion Chat';
    const messages = this.messages;

    if (!messages || messages.length === 0) {
      this.showShareToastMsg('⚠️ No messages to share yet');
      return;
    }

    this.showShareToastMsg('⏳ Creating share link...');

    // Save chat to Firestore shared_chats collection
    const sharedByName = this.getUserFullName() || 'AI Companion User';
    const shareId = await this.authService.createSharedChat(sessionTitle, messages, sharedByName);

    if (!shareId) {
      this.showShareToastMsg('⚠️ Could not create share link');
      return;
    }

    // Build the shareable URL with ?share=ID
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?share=${shareId}`;
    const shareTitle = `AI Companion — ${sessionTitle}`;
    const shareText = `Check out this AI conversation shared by ${sharedByName} 🤖`;

    if (navigator.share) {
      // Mobile: open native OS share sheet
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          this.showShareToastMsg('⚠️ Could not share');
        }
      }
    } else {
      // Desktop: copy the real shareable link
      this.copyToClipboard(shareUrl);
      this.showShareToastMsg('🔗 Share link copied! Anyone can open it.');
    }
  }

  async shareMessage(text: string) {
    const url = window.location.href;
    const title = 'AI Companion';
    const shareText = text.length > 280 ? text.substring(0, 277) + '...' : text;

    if (navigator.share) {
      try {
        await navigator.share({ title, text: shareText, url });
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          this.showShareToastMsg('⚠️ Could not share');
        }
      }
    } else {
      this.copyToClipboard(text);
      this.showShareToastMsg('📋 Message copied to clipboard!');
    }
  }

  // Check URL for ?share=ID and load shared chat
  async checkSharedChatOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('share');
    if (!shareId) return;

    this.sharedChatLoading = true;
    this.isSharedChatView = true;
    this.cdr.detectChanges();

    const data = await this.authService.getSharedChat(shareId);
    if (data) {
      this.sharedChatData = data;
    } else {
      this.sharedChatData = null;
    }
    this.sharedChatLoading = false;
    this.cdr.detectChanges();
  }

  // Check URL for ?admin_access=true (kept as legacy fallback — main access is via Sign In form)
  checkAdminAccessOnLoad() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin_access') === 'true') {
      this.isAdminPanelOpen = true;
      const url = new URL(window.location.href);
      url.searchParams.delete('admin_access');
      window.history.replaceState({}, '', url.toString());
      this.cdr.detectChanges();
    }
  }

  closeSharedChatView() {
    this.isSharedChatView = false;
    this.sharedChatData = null;
    // Remove ?share= param from URL without page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('share');
    window.history.replaceState({}, '', url.toString());
  }

  async logout() {
    await this.authService.logout();
    this.sessions = [];
    this.currentSessionId = null;
    this.createNewChat();
  }
}