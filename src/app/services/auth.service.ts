import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  User,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc,
  collection,
  addDoc
} from 'firebase/firestore';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

export interface ChatSession {
  id: number;
  title: string;
  messages: ChatMessage[];
}

export interface UserPreferences {
  callingName?: string;
  occupation?: string;
  tone?: string;
  interests?: string;
}

export interface UserMemory {
  id: string;        // unique ID for deletion
  fact: string;      // e.g. "User is a software engineer"
  addedAt: string;   // ISO date
  source: 'auto' | 'manual';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private app = initializeApp(environment.firebaseConfig);
  public auth = getAuth(this.app);
  public db = getFirestore(this.app);

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();
  public authInitialized = false;

  constructor() {
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        await this.saveUserProfile(user);
      }
      this.currentUserSubject.next(user);
      this.authInitialized = true;
    });
  }

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getUserDisplayName(user: { displayName?: string | null; email?: string | null } | null): string {
    if (!user) return 'User';
    if (user.displayName && user.displayName.trim()) {
      return user.displayName;
    }
    if (user.email) {
      const username = user.email.split('@')[0];
      return username.charAt(0).toUpperCase() + username.slice(1);
    }
    return 'User';
  }

  async saveUserProfile(user: User): Promise<void> {
    if (!user || !user.uid) return;
    try {
      const name = this.getUserDisplayName(user);
      const userDocRef = doc(this.db, 'users', user.uid);
      await setDoc(userDocRef, {
        displayName: name,
        email: user.email || '',
        photoURL: user.photoURL || '',
        lastLoginAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error('Error saving user profile to Firestore:', err);
    }
  }

  async loginWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(this.auth, provider);
    if (result.user) {
      await this.saveUserProfile(result.user);
    }
    return result.user;
  }

  async loginWithEmail(email: string, pass: string): Promise<User> {
    const result = await signInWithEmailAndPassword(this.auth, email, pass);
    if (result.user) {
      await this.saveUserProfile(result.user);
    }
    return result.user;
  }

  async registerWithEmail(email: string, pass: string, name?: string): Promise<User> {
    const result = await createUserWithEmailAndPassword(this.auth, email, pass);
    const finalName = name || this.getUserDisplayName({ email });
    if (result.user) {
      await updateProfile(result.user, { displayName: finalName });
      await this.saveUserProfile(result.user);
    }
    return result.user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  // --- FIRESTORE USER CHAT PERSISTENCE ---
  async saveUserSessions(uid: string, sessions: ChatSession[], currentUser?: User | null): Promise<void> {
    if (!uid) return;
    try {
      const targetUser = currentUser || this.auth.currentUser;
      const userDocRef = doc(this.db, 'users', uid);
      const updatePayload: any = {
        sessions: sessions,
        updatedAt: new Date().toISOString()
      };
      if (targetUser) {
        updatePayload.displayName = this.getUserDisplayName(targetUser);
        updatePayload.email = targetUser.email || '';
        updatePayload.photoURL = targetUser.photoURL || '';
        updatePayload.lastLoginAt = new Date().toISOString();
      }
      await setDoc(userDocRef, updatePayload, { merge: true });
    } catch (err) {
      console.error('Error saving user sessions to Firestore:', err);
    }
  }

  async getUserSessions(uid: string): Promise<ChatSession[] | null> {
    if (!uid) return null;
    try {
      const userDocRef = doc(this.db, 'users', uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists() && docSnap.data()['sessions']) {
        return docSnap.data()['sessions'] as ChatSession[];
      }
    } catch (err) {
      console.error('Error fetching user sessions from Firestore:', err);
    }
    return null;
  }

  // --- FIRESTORE USER PREFERENCES PERSISTENCE ---
  async saveUserPreferences(uid: string, prefs: UserPreferences): Promise<void> {
    if (!uid) return;
    try {
      const userDocRef = doc(this.db, 'users', uid);
      await setDoc(userDocRef, {
        preferences: prefs,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error('Error saving user preferences to Firestore:', err);
    }
  }

  async getUserPreferences(uid: string): Promise<UserPreferences | null> {
    if (!uid) return null;
    try {
      const userDocRef = doc(this.db, 'users', uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists() && docSnap.data()['preferences']) {
        return docSnap.data()['preferences'] as UserPreferences;
      }
    } catch (err) {
      console.error('Error fetching user preferences from Firestore:', err);
    }
    return null;
  }

  // --- LONG-TERM MEMORY (cross-session facts about user) ---
  async addMemories(uid: string, newFacts: string[]): Promise<UserMemory[]> {
    if (!uid || !newFacts.length) return [];
    try {
      const userDocRef = doc(this.db, 'users', uid);
      const docSnap = await getDoc(userDocRef);
      const existing: UserMemory[] = docSnap.exists() && docSnap.data()['memories']
        ? (docSnap.data()['memories'] as UserMemory[])
        : [];

      // Deduplicate — skip facts that are already stored (loose match)
      const existingFacts = existing.map(m => m.fact.toLowerCase());
      const toAdd = newFacts.filter(f => {
        const fl = f.toLowerCase();
        return !existingFacts.some(ef => ef.includes(fl.substring(0, 20)) || fl.includes(ef.substring(0, 20)));
      });

      const newMemories: UserMemory[] = toAdd.map(fact => ({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        fact,
        addedAt: new Date().toISOString(),
        source: 'auto'
      }));

      // Keep max 50 memories (drop oldest first)
      const combined = [...existing, ...newMemories].slice(-50);
      await setDoc(userDocRef, { memories: combined }, { merge: true });
      return combined;
    } catch (err) {
      console.error('Error saving memories:', err);
      return [];
    }
  }

  async getMemories(uid: string): Promise<UserMemory[]> {
    if (!uid) return [];
    try {
      const userDocRef = doc(this.db, 'users', uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists() && docSnap.data()['memories']) {
        return docSnap.data()['memories'] as UserMemory[];
      }
    } catch (err) {
      console.error('Error fetching memories:', err);
    }
    return [];
  }

  async deleteMemory(uid: string, memoryId: string): Promise<UserMemory[]> {
    if (!uid) return [];
    try {
      const userDocRef = doc(this.db, 'users', uid);
      const docSnap = await getDoc(userDocRef);
      if (!docSnap.exists()) return [];
      const existing: UserMemory[] = docSnap.data()['memories'] || [];
      const updated = existing.filter(m => m.id !== memoryId);
      await setDoc(userDocRef, { memories: updated }, { merge: true });
      return updated;
    } catch (err) {
      console.error('Error deleting memory:', err);
      return [];
    }
  }

  async clearAllMemories(uid: string): Promise<void> {
    if (!uid) return;
    try {
      const userDocRef = doc(this.db, 'users', uid);
      await setDoc(userDocRef, { memories: [] }, { merge: true });
    } catch (err) {
      console.error('Error clearing memories:', err);
    }
  }

  // --- SHARED CHAT (PUBLIC SHARING) ---
  async createSharedChat(title: string, messages: ChatMessage[], sharedByName: string): Promise<string | null> {
    try {
      const sharedChatsRef = collection(this.db, 'shared_chats');
      const docRef = await addDoc(sharedChatsRef, {
        title,
        messages,
        sharedByName,
        createdAt: new Date().toISOString(),
        // Auto-expire after 30 days (informational — enforce with Firestore TTL policy)
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });
      return docRef.id;
    } catch (err) {
      console.error('Error creating shared chat:', err);
      return null;
    }
  }

  async getSharedChat(shareId: string): Promise<{ title: string; messages: ChatMessage[]; sharedByName: string; createdAt: string } | null> {
    try {
      const sharedDocRef = doc(this.db, 'shared_chats', shareId);
      const docSnap = await getDoc(sharedDocRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          title: data['title'] || 'Shared Chat',
          messages: data['messages'] || [],
          sharedByName: data['sharedByName'] || 'Someone',
          createdAt: data['createdAt'] || ''
        };
      }
    } catch (err) {
      console.error('Error fetching shared chat:', err);
    }
    return null;
  }
}
