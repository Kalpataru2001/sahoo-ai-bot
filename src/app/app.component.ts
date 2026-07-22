import { Component, ElementRef, ViewChild, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { User } from 'firebase/auth';
import { AuthService } from './services/auth.service';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;

  sessions: ChatSession[] = [];
  currentSessionId: number | null = null;
  isSidebarOpen = false; // For mobile phones
  isDarkMode = true;
  userInput: string = '';
  isLoading = false;
  
  // Auth Variables
  currentUser: User | null = null;
  isAuthModalOpen = false;
  authMode: 'login' | 'register' = 'login';
  authEmail = '';
  authPassword = '';
  authName = '';
  authError = '';
  authLoading = false;

  // Voice Mode Variables
  isVoiceMode = false;
  isRecording = false; 
  botIsSpeaking = false;
  currentVoiceText = ''; // Shows what the bot/user is currently saying in the overlay
  availableVoices: SpeechSynthesisVoice[] = [];
  isDeleteModalOpen = false;
  chatToDeleteId: number | null = null;

  recognition: any; 
  indianVoice: SpeechSynthesisVoice | null = null;
  
  messages: Message[] = [
    { role: 'bot', text: 'Namaste Sahoo! Voice Mode is ready. Click the big floating mic to try it!' }
  ];

  constructor(
    private http: HttpClient, 
    private cdr: ChangeDetectorRef, 
    private sanitizer: DomSanitizer,
    public authService: AuthService
  ) {}

  renderMarkdown(text: string): SafeHtml {
    if (!text) return '';
    try {
      const html = marked.parse(text, { breaks: true }) as string;
      return this.sanitizer.bypassSecurityTrustHtml(html);
    } catch (e) {
      return text;
    }
  }

  // PWA Mobile Banner Variables
  deferredInstallPrompt: any = null;
  showInstallBanner = false;
  isIosDevice = false;
  showIosInstructions = false;

  ngOnInit() {
    this.initSpeechRecognition(); 
    this.loadVoices();
    this.initPwaInstallPrompt();

    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoices();
    };

    // Firebase Auth State Listener
    this.authService.currentUser$.subscribe(async (user) => {
      this.currentUser = user;
      if (user) {
        // Fetch User's Firestore Sessions
        const cloudSessions = await this.authService.getUserSessions(user.uid);
        if (cloudSessions && cloudSessions.length > 0) {
          this.sessions = cloudSessions;
          this.selectChat(this.sessions[0].id);
        } else {
          // If new user, migrate current sessions to Firestore
          await this.authService.saveUserSessions(user.uid, this.sessions);
        }
      } else {
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
    const newSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: [{ role: 'bot', text: 'Namaste Sahoo! What is on your mind?' }]
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
    this.isSidebarOpen = false; // Auto-close sidebar on mobile after clicking
    this.saveChats();
    setTimeout(() => this.scrollToBottom(), 60);
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
      this.authService.saveUserSessions(this.currentUser.uid, this.sessions);
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
    this.isDarkMode = !this.isDarkMode;
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
    setTimeout(() => this.scrollToBottom(), 60);
    
    if (this.isVoiceMode) {
      this.currentVoiceText = 'Thinking...';
    }

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

    this.http.post<{reply: string}>('https://sahoo-ai-proxy-us.onrender.com/api/chat', { message: userText ,history: geminiHistory})
      .subscribe({
        next: (response) => {
          this.messages.push({ role: 'bot', text: response.reply });
          this.saveChats();
          this.isLoading = false;
          setTimeout(() => this.scrollToBottom(), 60);
          if (this.isVoiceMode) {
            this.speak(response.reply);
          }
        },
        error: (err) => {
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

  async logout() {
    await this.authService.logout();
    this.createNewChat();
  }
}