import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sun, Moon, Upload, Send, X, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

// =====================================
// CONFIGURACIÓN DE LA API
// =====================================

// ⚠️ IMPORTANTE: En producción, NUNCA expongas tu API key en el frontend
// Solución recomendada: Crear un backend proxy que maneje las llamadas a la API
const API_KEY = import.meta.env.VITE_GROQ_API_KEY || "";
const MODEL_NAME = "llama-3.1-70b-versatile";
const API_URL = "https://api.groq.com/openai/v1/chat/completions";
// Límites de archivo
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = {
  'application/pdf': ['pdf'],
  'text/plain': ['txt'],
  'text/markdown': ['md'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png']
};

// =====================================
// UTILIDADES
// =====================================

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetries = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        
        // Mensajes de error más específicos
        if (response.status === 401) {
          throw new Error("API key inválida. Por favor, verifica tu configuración.");
        } else if (response.status === 429) {
          throw new Error("Límite de solicitudes excedido. Intenta de nuevo en unos minutos.");
        } else if (response.status === 400) {
          throw new Error(`Solicitud inválida: ${errorBody.error?.message || 'Verifica el formato del archivo'}`);
        }
        
        throw new Error(`Error HTTP ${response.status}: ${errorBody.error?.message || 'Error desconocido'}`);
      }
      
      return response;
    } catch (error) {
      console.error(`Intento ${i + 1} fallido:`, error);
      
      if (i === maxRetries - 1) throw error;
      
      const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
      await delay(waitTime);
    }
  }
};

// Validación de archivos
const validateFile = (file) => {
  if (!file) {
    return { valid: false, error: "No se seleccionó ningún archivo." };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    return { 
      valid: false, 
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(2)}MB). Máximo: 10MB.` 
    };
  }
  
  const isValidType = Object.keys(ALLOWED_FILE_TYPES).includes(file.type);
  if (!isValidType) {
    return { 
      valid: false, 
      error: `Tipo de archivo no soportado. Usa: PDF, TXT, MD, JPG, PNG.` 
    };
  }
  
  return { valid: true };
};

// =====================================
// API DE GEMINI
// =====================================

const generateContent = async (prompt, fileData, systemInstruction, responseMimeType = 'text/plain', responseSchema = null) => {
  if (!API_KEY) {
    throw new Error("API key no configurada. Agrega VITE_GEMINI_API_KEY a tu archivo .env");
  }

  const contents = [{
    role: "user",
    parts: [{ text: prompt }]
  }];

  if (fileData) {
    contents[0].parts.push({
      inlineData: {
        mimeType: fileData.mimeType,
        data: fileData.base64Data
      }
    });
  }

  const payload = {
    contents: contents,
    systemInstruction: { 
      parts: [{ text: systemInstruction }] 
    },
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
    }
  };

  if (responseMimeType.startsWith("application/json") && responseSchema) {
    payload.generationConfig.responseMimeType = responseMimeType;
    payload.generationConfig.responseSchema = responseSchema;
  }

  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };

  const response = await fetchWithRetries(API_URL, options);
  const result = await response.json();
  
  const candidate = result.candidates?.[0];
  
  if (!candidate?.content?.parts?.[0]?.text) {
    throw new Error(result.error?.message || "No se recibió respuesta del modelo");
  }
  
  const text = candidate.content.parts[0].text;
  
  if (responseMimeType.startsWith("application/json")) {
    try {
      // Limpiar posibles markdown code blocks
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
    } catch (e) {
      console.error("Error al parsear JSON:", e, "\nTexto recibido:", text);
      throw new Error("La IA no devolvió un JSON válido. Intenta de nuevo.");
    }
  }
  
  return text;
};

// =====================================
// ESQUEMAS JSON
// =====================================

const quizSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Título del cuestionario"
    },
    questions: {
      type: "array",
      description: "Lista de 5 preguntas de opción múltiple",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 4,
            maxItems: 4
          },
          correctAnswerIndex: { 
            type: "integer",
            minimum: 0,
            maximum: 3
          },
          explanation: { type: "string" }
        },
        required: ["question", "options", "correctAnswerIndex", "explanation"]
      },
      minItems: 5,
      maxItems: 5
    }
  },
  required: ["title", "questions"]
};

// =====================================
// COMPONENTES
// =====================================

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <XCircle className="w-5 h-5" />,
    info: <AlertCircle className="w-5 h-5" />
  };

  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500'
  };

  return (
    <div className={`fixed top-4 right-4 ${colors[type]} text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3 animate-slide-in z-50`}>
      {icons[type]}
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:opacity-80">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

const StudyOptions = React.memo(({ onSelectOption, isGenerating, materialLoaded, darkMode }) => {
  const baseClasses = "py-3 px-5 rounded-lg font-medium transition-all duration-200 shadow-md";
  const enabledClasses = "bg-blue-600 hover:bg-blue-700 text-white transform hover:scale-105 active:scale-95";
  const disabledClasses = "bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed opacity-50";

  const options = [
    {
      id: 'summary',
      label: 'Resumir Material',
      prompt: "Genera un resumen completo, estructurado y detallado del material proporcionado. Organiza la información en secciones claras con puntos clave."
    },
    {
      id: 'keypoints',
      label: 'Puntos Clave',
      prompt: "Identifica y enumera los 10 puntos más importantes del material. Para cada punto, proporciona una breve explicación."
    },
    {
      id: 'quiz',
      label: 'Generar Examen',
      prompt: "Crea 5 preguntas de opción múltiple basadas estrictamente en el material. Cada pregunta debe tener 4 opciones y una explicación detallada de la respuesta correcta."
    },
    {
      id: 'analogy',
      label: 'Explicar con Analogía',
      prompt: "Crea una analogía creativa y memorable para explicar los conceptos principales del material. Usa ejemplos de la vida cotidiana."
    }
  ];

  return (
    <div className={`p-5 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
      <h3 className={`text-lg font-bold mb-4 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
        Elige tu Modo de Estudio:
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map(option => (
          <button
            key={option.id}
            onClick={() => onSelectOption(option.label, option.prompt, option.id === 'quiz')}
            disabled={isGenerating || !materialLoaded}
            className={`${baseClasses} ${isGenerating || !materialLoaded ? disabledClasses : enabledClasses}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
});

const FileUploader = React.memo(({ onFileLoad, isGenerating, darkMode }) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (file) => {
    if (!file) return;

    const validation = validateFile(file);
    if (!validation.valid) {
      onFileLoad({ error: validation.error });
      return;
    }

    const reader = new FileReader();
    
    reader.onload = (e) => {
      const base64String = e.target.result.split(',')[1];
      const mimeType = file.type;

      onFileLoad({
        name: file.name,
        mimeType: mimeType,
        base64Data: base64String,
        size: file.size,
        text: mimeType.startsWith('text/') ? atob(base64String) : `[Archivo cargado: ${file.name}]`
      });
    };

    reader.onerror = () => {
      onFileLoad({ error: "Error al leer el archivo. Intenta de nuevo." });
    };

    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileChange(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <div className={`p-5 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white'}`}>
      <h3 className={`text-lg font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
        Sube tu Material de Estudio
      </h3>
      <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Soporta: PDF, TXT, MD, JPG, PNG (máx. 10MB)
      </p>
      
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isGenerating && fileInputRef.current?.click()}
        className={`
          w-full p-8 rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer
          ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600'}
          ${isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700'}
        `}
      >
        <div className="flex flex-col items-center gap-3">
          <Upload className={`w-12 h-12 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className={`text-center ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {isGenerating ? 'Procesando...' : isDragging ? 'Suelta el archivo aquí' : 'Arrastra un archivo o haz clic para seleccionar'}
          </p>
        </div>
      </div>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFileChange(e.target.files[0])}
        accept={Object.values(ALLOWED_FILE_TYPES).flat().map(ext => `.${ext}`).join(',')}
        className="hidden"
        disabled={isGenerating}
      />
    </div>
  );
});

const ChatMessage = ({ message, darkMode }) => {
  const isUser = message.role === 'user';
  const bgColor = isUser 
    ? (darkMode ? 'bg-blue-600' : 'bg-blue-500') 
    : (darkMode ? 'bg-gray-700' : 'bg-white border border-gray-200');
  const textColor = isUser ? 'text-white' : (darkMode ? 'text-gray-200' : 'text-gray-800');
  const alignment = isUser ? 'self-end' : 'self-start';

  const formatText = (text) => {
    if (!text) return null;
    
    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-gray-200 dark:bg-gray-800 px-1 rounded text-sm">$1</code>')
      .replace(/\n/g, '<br/>');
    
    return formatted;
  };

  return (
    <div className={`flex flex-col mb-4 max-w-[85%] ${alignment} animate-fade-in`}>
      <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {isUser ? 'Tú' : '🤖 Tutor IA'}
      </div>
      <div 
        className={`p-4 rounded-2xl ${bgColor} ${textColor} shadow-md`}
        dangerouslySetInnerHTML={{ __html: formatText(message.text) }}
      />
    </div>
  );
};

const ExamModal = ({ challenge, onClose, onSubmit, darkMode }) => {
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  const handleSelect = (qIndex, oIndex) => {
    if (!submitted) {
      setSelectedAnswers(prev => ({ ...prev, [qIndex]: oIndex }));
    }
  };

  const handleSubmit = () => {
    setSubmitted(true);
    let currentScore = 0;
    
    challenge.questions.forEach((q, qIndex) => {
      if (selectedAnswers[qIndex] === q.correctAnswerIndex) {
        currentScore++;
      }
    });
    
    setScore(currentScore);
    
    const percentage = Math.round((currentScore / challenge.questions.length) * 100);
    const resultText = `📊 **Resultados del Examen**\n\nPuntuación: **${currentScore}/${challenge.questions.length}** (${percentage}%)\n\n` + 
      challenge.questions.map((q, qIndex) => {
        const isCorrect = selectedAnswers[qIndex] === q.correctAnswerIndex;
        const userChoice = selectedAnswers[qIndex] !== undefined ? q.options[selectedAnswers[qIndex]] : "Sin responder";
        
        return (
          `**Pregunta ${qIndex + 1}:** ${q.question}\n` +
          `Tu respuesta: *${userChoice}* ${isCorrect ? '✅' : '❌'}\n` +
          `${!isCorrect ? `Respuesta correcta: *${q.options[q.correctAnswerIndex]}*\n` : ''}` +
          `💡 ${q.explanation}\n`
        );
      }).join('\n---\n');
    
    onSubmit(resultText);
  };

  if (!challenge) return null;

  const percentage = submitted ? Math.round((score / challenge.questions.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-70 backdrop-blur-sm animate-fade-in">
      <div className={`w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-6 ${darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-800'}`}>
        <div className="flex justify-between items-center border-b pb-4 mb-6">
          <h2 className="text-2xl font-extrabold text-blue-500">{challenge.title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-blue-500 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        {submitted && (
          <div className={`p-6 mb-6 rounded-lg text-center ${percentage >= 80 ? 'bg-green-500/20 border-2 border-green-500' : percentage >= 60 ? 'bg-yellow-500/20 border-2 border-yellow-500' : 'bg-red-500/20 border-2 border-red-500'}`}>
            <h3 className="text-3xl font-bold mb-2">{score} / {challenge.questions.length}</h3>
            <p className="text-lg">
              {percentage >= 80 ? '🎉 ¡Excelente trabajo!' : percentage >= 60 ? '👍 Buen intento' : '📚 Sigue estudiando'}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
              <div 
                className={`h-2 rounded-full transition-all duration-500 ${percentage >= 80 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )}

        <div className="space-y-6">
          {challenge.questions.map((q, qIndex) => (
            <div key={qIndex} className={`p-5 rounded-lg border-2 transition-all ${submitted && selectedAnswers[qIndex] !== q.correctAnswerIndex ? 'border-red-500' : darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h4 className="text-lg font-semibold mb-4">
                <span className="text-blue-500 mr-2">{qIndex + 1}.</span>
                {q.question}
              </h4>
              
              <div className="space-y-2">
                {q.options.map((option, oIndex) => {
                  const isSelected = selectedAnswers[qIndex] === oIndex;
                  const isCorrect = submitted && oIndex === q.correctAnswerIndex;
                  const isWrong = submitted && isSelected && !isCorrect;

                  return (
                    <button
                      key={oIndex}
                      onClick={() => handleSelect(qIndex, oIndex)}
                      disabled={submitted}
                      className={`
                        w-full text-left py-3 px-4 rounded-lg transition-all border-2
                        ${submitted ? 'cursor-default' : 'cursor-pointer hover:border-blue-500'}
                        ${isCorrect ? 'bg-green-500/20 border-green-500 font-bold' : ''}
                        ${isWrong ? 'bg-red-500/20 border-red-500 opacity-70' : ''}
                        ${!submitted && isSelected ? 'bg-blue-500/20 border-blue-500' : ''}
                        ${!submitted && !isSelected ? 'border-gray-300 dark:border-gray-600' : ''}
                      `}
                    >
                      <span className="font-mono mr-2">{String.fromCharCode(65 + oIndex)}.</span>
                      {option}
                      {isCorrect && <span className="ml-2">✅</span>}
                      {isWrong && <span className="ml-2">❌</span>}
                    </button>
                  );
                })}
              </div>

              {submitted && (
                <div className={`mt-4 p-3 rounded-lg text-sm ${selectedAnswers[qIndex] === q.correctAnswerIndex ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                  <strong>💡 Explicación:</strong> {q.explanation}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t flex justify-end gap-3">
          {!submitted ? (
            <button 
              onClick={handleSubmit}
              disabled={Object.keys(selectedAnswers).length < challenge.questions.length}
              className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              {Object.keys(selectedAnswers).length < challenge.questions.length 
                ? `Responder (${Object.keys(selectedAnswers).length}/${challenge.questions.length})`
                : 'Finalizar Examen'
              }
            </button>
          ) : (
            <button 
              onClick={onClose}
              className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// =====================================
// COMPONENTE PRINCIPAL
// =====================================

export default function App() {
  const [chatHistory, setChatHistory] = useState([]);
  const [fileData, setFileData] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });
  const [toast, setToast] = useState(null);

  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  const handleFileLoad = useCallback((data) => {
    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    setFileData(data);
    setChatHistory([
      { role: 'user', text: `[Archivo Cargado: ${data.name} (${(data.size / 1024).toFixed(2)} KB)]` },
      { role: 'model', text: `✅ ¡Material cargado con éxito!\n\nArchivo: **${data.name}**\nTamaño: ${(data.size / 1024).toFixed(2)} KB\n\nAhora puedes:\n- 📝 Obtener un resumen\n- 🎯 Ver los puntos clave\n- 📊 Generar un examen\n- 💡 Pedir una explicación con analogías\n\n¿Qué te gustaría hacer?` }
    ]);
    setCurrentChallenge(null);
    showToast('Archivo cargado exitosamente', 'success');
  }, []);

  const processChat = useCallback(async (prompt, systemInstruction, responseMimeType = 'text/plain', responseSchema = null) => {
    setIsGenerating(true);
    setChatHistory(prev => [...prev, { role: 'user', text: prompt }]);

    try {
      const aiResponse = await generateContent(
        prompt,
        fileData,
        systemInstruction,
        responseMimeType,
        responseSchema
      );

      if (responseMimeType === 'application/json' && typeof aiResponse === 'object') {
        setCurrentChallenge(aiResponse);
        setChatHistory(prev => [...prev, { 
          role: 'model', 
          text: `📝 He generado un examen de **${aiResponse.questions.length} preguntas** sobre el material.\n\n🎯 Completa el examen en la ventana que acaba de aparecer. ¡Buena suerte!` 
        }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'model', text: aiResponse }]);
      }
    } catch (error) {
      console.error("Error:", error);
      showToast(error.message, 'error');
      setChatHistory(prev => [...prev, { 
        role: 'model', 
        text: `❌ Lo siento, ocurrió un error:\n\n${error.message}\n\nPor favor, intenta de nuevo.` 
      }]);
    } finally {
      setIsGenerating(false);
    }
  }, [fileData]);

const handleSelectOption = (optionType, promptInstruction, isQuiz = false) => {
  // ... código existente ...
  
  processChat(userPrompt, systemPrompt, isQuiz); // ← Cambia el tercer parámetro
};

    const fileDescription = fileData.text.length > 1000 
      ? fileData.text.substring(0, 1000) + '...' 
      : fileData.text;

    const systemPrompt = `Eres un tutor de estudio experto y didáctico. Analiza el material proporcionado y cumple con la solicitud de manera clara, estructurada y educativa.`;

    const userPrompt = `Material de estudio:\n\n"${fileDescription}"\n\nTarea: ${promptInstruction}`;

    if (optionType === 'Generar Examen') {
      processChat(userPrompt, systemPrompt, 'application/json', quizSchema);
    } else {
      processChat(userPrompt, systemPrompt);
    }
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!userInput.trim() || isGenerating) return;

    const systemPrompt = "Eres un tutor de estudio útil y conciso. Responde las preguntas de manera clara y educativa.";
    const promptWithContext = fileData 
      ? `[Contexto: Archivo "${fileData.name}" cargado]\n\nPregunta: ${userInput}`
      : userInput;

    processChat(promptWithContext, systemPrompt);
    setUserInput('');
  };

  const handleExamSubmit = (resultText) => {
    setChatHistory(prev => [
      ...prev,
      { role: 'user', text: "He completado el examen." },
      { role: 'model', text: resultText }
    ]);
    setCurrentChallenge(null);
  };

  return (
    <div className={`min-h-screen flex flex-col ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-800'}`}>
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
      `}</style>

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}

      <header className={`sticky top-0 z-40 px-6 py-4 shadow-md ${darkMode ? 'bg-gray-800 border-b border-gray-700' : 'bg-white'}`}>
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-extrabold text-blue-500 flex items-center gap-2">
            📚 Gemini Study Tutor
          </h1>
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
            title={darkMode ? "Modo Claro" : "Modo Oscuro"}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <FileUploader onFileLoad={handleFileLoad} isGenerating={isGenerating} darkMode={darkMode} />
          <StudyOptions 
            onSelectOption={handleSelectOption}
            isGenerating={isGenerating}
            materialLoaded={!!fileData}
            darkMode={darkMode}
          />
          
          {fileData && (
            <div className={`p-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <h3 className="text-sm font-bold mb-2 text-gray-500 dark:text-gray-400">MATERIAL ACTIVO</h3>
              <p className="text-sm font-medium text-blue-500 truncate mb-1">{fileData.name}</p>
              <p className="text-xs text-gray-500">{(fileData.size / 1024).toFixed(2)} KB</p>
              <button
                onClick={() => {
                  setFileData(null);
                  setChatHistory([]);
                  showToast('Material eliminado', 'info');
                }}
                className="mt-3 text-xs text-red-500 hover:text-red-600 font-medium"
              >
                Quitar Material
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 flex flex-col h-[75vh] lg:h-[85vh]">
          <div 
            ref={chatContainerRef}
            className={`flex-grow overflow-y-auto p-4 space-y-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}
          >
            {chatHistory.length === 0 ? (
              <div className="text-center p-10 space-y-4">
                <h2 className="text-2xl font-bold mb-2">¡Bienvenido a tu Tutor IA! 👋</h2>
                <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>
                  Sube un documento o imagen para comenzar tu sesión de estudio.
                </p>
                <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'}`}>
                    <div className="text-2xl mb-2">📝</div>
                    <strong>Resúmenes</strong>
                    <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Genera resúmenes concisos</p>
                  </div>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'}`}>
                    <div className="text-2xl mb-2">🎯</div>
                    <strong>Puntos Clave</strong>
                    <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Identifica lo más importante</p>
                  </div>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'}`}>
                    <div className="text-2xl mb-2">📊</div>
                    <strong>Exámenes</strong>
                    <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Practica con cuestionarios</p>
                  </div>
                  <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-white'}`}>
                    <div className="text-2xl mb-2">💡</div>
                    <strong>Analogías</strong>
                    <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Aprende con ejemplos</p>
                  </div>
                </div>
              </div>
            ) : (
              chatHistory.map((msg, index) => (
                <ChatMessage key={index} message={msg} darkMode={darkMode} />
              ))
            )}

            {isGenerating && (
              <div className="flex flex-col mb-4 max-w-[85%] self-start animate-fade-in">
                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  🤖 Tutor IA
                </div>
                <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-white border border-gray-200'} shadow-md`}>
                  <div className="flex items-center space-x-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                    <span>Generando respuesta...</span>
                  </div>
                  <div className="mt-3 w-full bg-blue-200 dark:bg-blue-900 rounded-full h-1">
                    <div className="bg-blue-600 h-1 rounded-full animate-pulse" style={{ width: '70%' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSendChat} className="mt-4 flex gap-3">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={fileData ? "Pregunta sobre el material..." : "Sube un archivo primero..."}
              className={`flex-grow p-3 rounded-xl border-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
              disabled={isGenerating}
            />
            <button
              type="submit"
              disabled={isGenerating || !userInput.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Enviar
            </button>
          </form>
        </div>
      </main>

      {currentChallenge && (
        <ExamModal
          challenge={currentChallenge}
          onClose={() => setCurrentChallenge(null)}
          onSubmit={handleExamSubmit}
          darkMode={darkMode}
        />
      )}
    </div>
  );
}