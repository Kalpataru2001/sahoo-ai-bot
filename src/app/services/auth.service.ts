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
  getDocs 
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
    onAuthStateChanged(this.auth, (user) => {
      this.currentUserSubject.next(user);
      this.authInitialized = true;
    });
  }

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  async loginWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(this.auth, provider);
    return result.user;
  }

  async loginWithEmail(email: string, pass: string): Promise<User> {
    const result = await signInWithEmailAndPassword(this.auth, email, pass);
    return result.user;
  }

  async registerWithEmail(email: string, pass: string, name?: string): Promise<User> {
    const result = await createUserWithEmailAndPassword(this.auth, email, pass);
    if (name && result.user) {
      await updateProfile(result.user, { displayName: name });
    }
    return result.user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  // --- FIRESTORE USER CHAT PERSISTENCE ---
  async saveUserSessions(uid: string, sessions: ChatSession[]): Promise<void> {
    if (!uid) return;
    try {
      const userDocRef = doc(this.db, 'users', uid);
      await setDoc(userDocRef, { 
        sessions: sessions, 
        updatedAt: new Date().toISOString() 
      }, { merge: true });
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
}
