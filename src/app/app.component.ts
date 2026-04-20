import { Component, ElementRef, ViewChild, AfterViewChecked, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface Message {
  role: 'user' | 'bot';
  text: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewChecked, OnInit {
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;

  isDarkMode = true;
  userInput: string = '';
  isLoading = false;
  
  // Voice Mode Variables
  isVoiceMode = false;
  isRecording = false; 
  botIsSpeaking = false;
  currentVoiceText = ''; // Shows what the bot/user is currently saying in the overlay
  availableVoices: SpeechSynthesisVoice[] = [];

  recognition: any; 
  indianVoice: SpeechSynthesisVoice | null = null;
  
  messages: Message[] = [
    { role: 'bot', text: 'Namaste Sahoo! Voice Mode is ready. Click the big floating mic to try it!' }
  ];

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.initSpeechRecognition(); 
    this.loadVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      this.loadVoices();
    };
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }
  

  scrollToBottom(): void {
    try {
      this.myScrollContainer.nativeElement.scrollTop = this.myScrollContainer.nativeElement.scrollHeight;
    } catch(err) { }
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

    const userText = this.userInput;
    this.messages.push({ role: 'user', text: userText });
    this.userInput = ''; 
    this.isLoading = true;
    
    if (this.isVoiceMode) {
      this.currentVoiceText = 'Thinking...';
    }

    const geminiHistory = this.messages
      .filter(m => m.text !== 'Backend is sleeping!' && m.text !== 'Connection Error.')
      .slice(0, -1) 
      .slice(-10)   
      .map(m => ({
        role: m.role === 'bot' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }));

    this.http.post<{reply: string}>('https://sahoo-ai-proxy.onrender.com/api/chat', { message: userText ,history: geminiHistory})
      .subscribe({
        next: (response) => {
          this.messages.push({ role: 'bot', text: response.reply });
          this.isLoading = false;
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
}