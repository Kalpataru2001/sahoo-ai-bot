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
  getDoc 
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
}
