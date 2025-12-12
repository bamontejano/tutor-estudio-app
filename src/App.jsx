import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, FileText, Image, Bot, Loader, X, Zap, Edit, BookOpen, Layers, Check, AlertTriangle, Send, Settings, Award, MessageSquare } from 'lucide-react';

// CONFIGURACIÓN GLOBAL
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ""; 

// Enumeración de vistas
const View = {
  EXAM_MULTIPLE: 'EXAM_MULTIPLE',
  EXAM_DEVELOPMENT: 'EXAM_DEVELOPMENT',
  SUMMARY: 'SUMMARY',
  FLASHCARDS: 'FLASHCARDS',
};

// Esquema JSON para examen de opción múltiple
const MULTIPLE_CHOICE_SCHEMA = {
    type: "OBJECT",
    properties: {
        title: { 
            type: "STRING", 
            description: "Título breve del examen." 
        },
        questions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    question: { type: "STRING" },
                    options: { 
                        type: "ARRAY",
                        items: { type: "STRING" },
                        description: "Lista de opciones, cada una debe empezar con la letra de la opción (A. Opción, B. Otra Opción)."
                    },
                    correct_answer: { 
                        type: "STRING", 
                        description: "La letra de la respuesta correcta (ej: 'A', 'B', 'C')." 
                    }
                },
                required: ["question", "options", "correct_answer"]
            }
        }
    },
    required: ["title", "questions"]
};

// --- FUNCIÓN DE UTILIDAD: Conversión de Imagen a Base64 ---
const getBase64Image = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]); 
        reader.onerror = error => reject(error);
    });
};

// --- COMPONENTE: Toast (Notificaciones) ---
const Toast = ({ message, type, onClose }) => {
    if (!message) return null;

    const baseClasses = "fixed bottom-5 left-1/2 transform -translate-x-1/2 p-4 rounded-xl shadow-2xl transition-all duration-300 z-50 flex items-center space-x-2 animate-bounce-in";
    let styleClasses = "";
    let Icon = MessageSquare;

    switch (type) {
        case 'error':
            styleClasses = "bg-red-600 text-white";
            Icon = AlertTriangle;
            break;
        case 'success':
            styleClasses = "bg-green-600 text-white";
            Icon = Check;
            break;
        case 'warning':
        default:
            styleClasses = "bg-yellow-500 text-white";
            Icon = AlertTriangle;
            break;
    }

    return (
        <div className={`${baseClasses} ${styleClasses}`} role="alert">
            <Icon className="w-5 h-5" />
            <span className="text-sm font-medium">{message}</span>
            <button onClick={onClose} className="ml-3 text-white/80 hover:text-white transition">
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};


// --- COMPONENTE PRINCIPAL ---
const App = () => {
  // --- ESTADO DE LA APLICACIÓN ---
  const [currentView, setCurrentView] = useState(View.EXAM_MULTIPLE);
  
  // Estado del Toast
  const [toast, setToast] = useState({ message: null, type: 'warning' }); 
  
  // Estados del archivo cargado
  const [file, setFile] = useState(null);
  const [fileContent, setFileContent] = useState(''); 
  const [fileType, setFileType] = useState(null); 
  const [isFileContentReady, setIsFileContentReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Estados de configuración de examen
  const [numQuestions, setNumQuestions] = useState(5); 
  const [numOptions, setNumOptions] = useState(4);
  const [studentLevel, setStudentLevel] = useState('Intermedio'); 
  
  // ESTADOS para el flujo de 2 pasos (Desafío)
  const [currentChallenge, setCurrentChallenge] = useState(null); 
  const [userSubmission, setUserSubmission] = useState('');       
  const [userSelections, setUserSelections] = useState({});       
  const [chatHistory, setChatHistory] = useState([]); 
  
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  // Manejador de Toast
  const showToast = useCallback((message, type = 'warning') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: null }), 5000);
  }, []);
  
  // Función para hacer scroll al final del chat
  const scrollToBottom = useCallback(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);
  
  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, scrollToBottom]);


  // --- LÓGICA DE ARCHIVOS ---

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    
    setToast({ message: null });
    setFile(null);
    setFileContent('');
    setFileType(null);
    setIsFileContentReady(false);
    setCurrentChallenge(null); 
    setUserSubmission('');
    setUserSelections({});
    
    if (!selectedFile) return;

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (selectedFile.size > MAX_FILE_SIZE) {
        showToast("El archivo es demasiado grande. Máximo 5MB.", 'error');
        return;
    }
    
    const mimeType = selectedFile.type;
    const isImage = mimeType.startsWith('image/');

    setFile(selectedFile);
    setFileType(mimeType);

    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            if (isImage) {
                const base64Data = await getBase64Image(selectedFile);
                setFileContent(base64Data);
            } else {
                setFileContent(e.target.result);
            }
            setIsFileContentReady(true);
            showToast(`Material "${selectedFile.name}" cargado con éxito.`, 'success');
        } catch (error) {
            showToast(`Error al procesar el archivo: ${error.message}`, 'error');
            setFile(null);
            setFileContent('');
        }
    };
    
    reader.onerror = () => {
      showToast("Error de lectura del archivo. Asegúrate de que no esté corrupto.", 'error');
      setFile(null);
      setFileContent('');
    };

    if (isImage) {
        reader.readAsDataURL(selectedFile); 
    } else {
        reader.readAsText(selectedFile);
    }
  };

  const clearFile = () => {
    setFile(null);
    setFileContent('');
    setFileType(null);
    setIsFileContentReady(false);
    setCurrentChallenge(null);
    setUserSubmission('');
    setUserSelections({});
    setChatHistory([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; 
    }
    showToast("Material de estudio y conversación borrados.", 'warning');
  };
  
  // --- GESTIÓN DEL HISTORIAL DE CHAT (Local) ---
  const saveMessage = useCallback((role, text, isSubmission = false, isError = false, correctionData = null) => {
      const message = {
          role,
          text,
          timestamp: Date.now(),
          isSubmission: !!isSubmission,
          isError: !!isError,
          file: file ? { name: file.name, type: fileType } : null,
          ...(correctionData && { correctionData: correctionData }) 
      };
      
      setChatHistory(prev => [...prev, message]);
  }, [file, fileType]);


  // --- LÓGICA DE LLAMADA A GEMINI (Con Backoff) ---

  const handleGeminiCall = useCallback(async (userPrompt, isCorrection = false, structuredSchema = null, maxRetries = 3) => {
    if (!file || !isFileContentReady) throw new Error('El material no está cargado.');
    if (!GEMINI_API_KEY) throw new Error('API Key no configurada. Por favor, configura la variable de entorno VITE_GEMINI_API_KEY.');
    
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    let systemInstruction;

    // 1. Construir el prompt para la IA
    let parts = [];

    if (isCorrection) {
        let challengeDataText = `Preguntas de Desarrollo:\n${currentChallenge.data}\nRespuestas del usuario:\n${userSubmission}`;
        
        systemInstruction = "Actúa como un profesor experto y conciso. Proporciona una corrección detallada, una puntuación (inventada, ej: 85/100) y un feedback constructivo. Muestra las respuestas correctas o puntos clave para mejorar. Base la corrección estrictamente en el material adjunto.";
        parts.push({ text: `Por favor, evalúa y corrige las siguientes respuestas proporcionadas por el usuario, basándote en el material de estudio adjunto y el desafío original. ${challengeDataText}` });

    } else {
        if (fileType.startsWith('image/')) {
            systemInstruction = "Actúa como un tutor de estudio experto. Analiza la imagen proporcionada como material de estudio. Tu tarea es generar la solicitud del usuario (examen, resumen, flashcards, etc.) basándote ÚNICAMENTE en la información visible o el texto detectado en la imagen.";
            parts.push({ text: userPrompt });
            parts.push({
                inlineData: {
                    mimeType: fileType,
                    data: fileContent
                }
            });
        } else {
            systemInstruction = structuredSchema 
                ? "Actúa como un generador de exámenes. Crea un examen de opción múltiple estrictamente a partir del material de estudio. DEVUELVE ÚNICAMENTE el JSON solicitado."
                : "Actúa como un tutor de estudio experto. Proporciona una respuesta detallada y bien organizada basándote estrictamente en el material de estudio. Usa Markdown para formatear la respuesta.";
                
            const materialContext = `\n\n--- MATERIAL DE ESTUDIO ---\n${fileContent}\n\n-------------------------------\n\n`;
            parts.push({ text: `${userPrompt}\n\nContenido: ${materialContext}` });
        }
    }
    
    const payload = {
        contents: [{ parts: parts }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    if (structuredSchema) {
        payload.generationConfig = {
            responseMimeType: "application/json",
            responseSchema: structuredSchema
        };
    }

    const userMessageText = isCorrection 
        ? (currentChallenge?.type === 'multiple' ? `Respuestas seleccionadas: ${Object.keys(userSelections).map(k => `P${parseInt(k)+1}: ${userSelections[k]}`).join(', ')}` : `Respuestas enviadas:\n\n${userSubmission}`)
        : userPrompt;
    
    saveMessage("user", userMessageText, isCorrection);
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) { 
                if (attempt < maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; 
                }
            }

            if (!response.ok) {
                const errorBody = await response.json();
                console.error("Error de API:", response.status, errorBody);
                throw new Error(`Fallo de la API: ${response.status} - ${errorBody.error?.message || 'Error desconocido'}`);
            }

            const result = await response.json();
            const candidate = result.candidates?.[0];

            if (candidate && candidate.content?.parts?.[0]?.text) {
                const textResult = candidate.content.parts[0].text;
                
                let challengeData = null;
                if (structuredSchema) {
                    try {
                        challengeData = JSON.parse(textResult);
                    } catch (e) {
                        console.error("Error al parsear JSON de la IA:", e, textResult);
                        throw new Error("La IA no devolvió un JSON válido para el examen.");
                    }
                }
                
                saveMessage("model", textResult, isCorrection, false, challengeData);
                return structuredSchema ? challengeData : textResult;
            } else {
                console.error("Respuesta de IA vacía o incompleta:", result);
                throw new Error("La IA no pudo generar una respuesta completa.");
            }

        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
  }, [saveMessage, file, isFileContentReady, fileContent, fileType, currentChallenge, userSelections, userSubmission, GEMINI_API_KEY, showToast]); 

  // --- LÓGICA DE CORRECCIÓN LOCAL (Opción Múltiple) ---

  const handleSubmitMultipleChoice = useCallback(() => {
    if (!currentChallenge || currentChallenge.type !== 'multiple') return;

    const questions = currentChallenge.data.questions;
    let correctCount = 0;
    const results = questions.map((q, index) => {
        const userAnswer = userSelections[index]; 
        const isCorrect = userAnswer === q.correct_answer;
        if (isCorrect) correctCount++;
        return {
            qIndex: index,
            userAnswer: userAnswer,
            isCorrect: isCorrect,
            correctAnswer: q.correct_answer,
        };
    });

    const totalQuestions = questions.length;
    const scorePercentage = (correctCount / totalQuestions) * 100;
    const isPassing = scorePercentage >= 60;
    
    showToast(`¡Examen completado! Obtuviste un ${scorePercentage.toFixed(0)}%.`, isPassing ? 'success' : 'error');

    setCurrentChallenge(prev => ({
        ...prev,
        isCorrected: true,
        score: correctCount,
        total: totalQuestions,
        percentage: scorePercentage,
        results: results,
    }));

    saveMessage("model", 
        `¡Examen corregido! Obtuviste **${correctCount} de ${totalQuestions}** (${scorePercentage.toFixed(0)}%). Revisa las preguntas de arriba para ver las respuestas correctas.`, 
        true, 
        false,
        { type: 'correction', score: correctCount, total: totalQuestions, percentage: scorePercentage }
    );

  }, [currentChallenge, userSelections, saveMessage, showToast]);


  // --- CONTROLADOR GENERAL DE SUBMISIÓN ---
  const handleSubmitChallenge = useCallback(async () => {
    if (!currentChallenge) return;
    
    if (currentChallenge.type === 'multiple') {
        const totalQuestions = currentChallenge.data.questions?.length || 0;
        const answeredCount = Object.values(userSelections).filter(s => s !== null).length;

        if (answeredCount < totalQuestions) {
             showToast(`Por favor, responde las ${totalQuestions - answeredCount} preguntas restantes antes de corregir.`, 'warning');
             return;
        }
        handleSubmitMultipleChoice();
        return;
    } 
    
    if (currentChallenge.type === 'development') {
        if (!userSubmission.trim()) {
            showToast("Por favor, escribe tus respuestas de desarrollo antes de corregir.", 'warning');
             return;
        }
        
        setIsGenerating(true);
        try {
            showToast("Enviando respuestas a la IA para corrección...", 'warning');
            await handleGeminiCall("Solicitud de corrección de examen", true, null);
            
            setCurrentChallenge(prev => ({ ...prev, isCorrected: true }));
            showToast("Corrección recibida. Revisa el historial de chat.", 'success');
            
        } catch (error) {
            showToast(`Error de la API de corrección: ${error.message}`, 'error');
            saveMessage("model", `ERROR: La llamada a la API de corrección falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, true, true);
        } finally {
            setIsGenerating(false);
        }
    }
  }, [currentChallenge, handleSubmitMultipleChoice, handleGeminiCall, userSubmission, userSelections, saveMessage, showToast]);


  const generateOneStepContent = useCallback(async (actionPrompt) => {
    setIsGenerating(true);
    setCurrentChallenge(null); 
    setUserSubmission('');
    setUserSelections({});
    
    try {
        await handleGeminiCall(actionPrompt, false, null); 
        showToast("Contenido generado con éxito. Revisa el chat.", 'success');
    } catch (error) {
        showToast(`Error de la API: ${error.message}`, 'error');
        saveMessage("model", `ERROR: La llamada a la API falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, false, true);
    } finally {
        setIsGenerating(false);
    }
  }, [handleGeminiCall, saveMessage, showToast]);


  const generateChallenge = useCallback(async (type, prompt) => {
    setIsGenerating(true);
    setCurrentChallenge(null);
    setUserSubmission('');
    setUserSelections({});

    const isMC = type === 'multiple';

    try {
        const generatedContent = await handleGeminiCall(prompt, false, isMC ? MULTIPLE_CHOICE_SCHEMA : null);
        
        if (isMC) {
            const parsedJson = generatedContent;
            setCurrentChallenge({ 
                type, 
                data: parsedJson, 
                userPrompt: prompt, 
                isCorrected: false, 
            });

            const initialSelections = {};
            if (parsedJson.questions) {
                parsedJson.questions.forEach((_, index) => {
                    initialSelections[index] = null;
                });
            }
            setUserSelections(initialSelections);
            showToast("Examen de opción múltiple generado. ¡A responder!", 'success');
        } else {
            setCurrentChallenge({ 
                type, 
                data: generatedContent, 
                userPrompt: prompt,
                isCorrected: false, 
            });
            showToast("Preguntas de desarrollo generadas. ¡A escribir!", 'success');
        }

    } catch (error) {
        showToast(`Error de la API: ${error.message}`, 'error');
        saveMessage("model", `ERROR: La llamada a la API falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, false, true);
    } finally {
        setIsGenerating(false);
    }
  }, [handleGeminiCall, saveMessage, showToast]); 

  const handleSelectionChange = useCallback((qIndex, optionLetter) => {
    if (currentChallenge && currentChallenge.isCorrected) return;

    setUserSelections(prev => ({
        ...prev,
        [qIndex]: optionLetter,
    }));
  }, [currentChallenge]);
  
  const totalMultipleChoiceAnswered = currentChallenge && currentChallenge.type === 'multiple'
    ? Object.values(userSelections).filter(s => s !== null).length
    : 0;
  const totalQuestionsMC = currentChallenge && currentChallenge.type === 'multiple'
    ? currentChallenge.data.questions?.length || 0
    : 0;


  // --- SUB-COMPONENTES DE INTERFAZ POR VISTA ---

  const renderInputControls = () => {
    const isReadyForAction = isFileContentReady && !isGenerating; 
    const isChallengeActive = currentChallenge !== null;
    
    // Controladores de un solo paso (Resumen, Flashcards)
    if (currentView === View.SUMMARY || currentView === View.FLASHCARDS) {
        const isSummary = currentView === View.SUMMARY;
        const prompt = isSummary 
            ? "Proporciona un resumen conciso y completo que cubra todos los puntos clave del contenido proporcionado. Utiliza subtítulos y listas de Markdown."
            : "Extrae 10 conceptos clave del material y sus definiciones/explicaciones en formato de flashcards (concepto: definición).";

        return (
            <div className="p-4 border-t bg-white flex justify-center shadow-lg">
                <button
                    onClick={() => generateOneStepContent(prompt)}
                    className={`w-full sm:w-1/2 px-6 py-3 rounded-full text-white font-semibold transition duration-300 shadow-xl flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
                        isReadyForAction ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-300 cursor-not-allowed'
                    }`}
                    disabled={!isReadyForAction || isChallengeActive}
                >
                    {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : (isSummary ? <BookOpen className="w-5 h-5 mr-2" /> : <Layers className="w-5 h-5 mr-2" />)}
                    Generar {isSummary ? 'Resumen' : 'Flashcards'}
                </button>
            </div>
        );
    }
    
    // --- Controladores de dos pasos (Exámenes)
    
    const isMultipleChoice = currentView === View.EXAM_MULTIPLE;
    const actionPrompt = isMultipleChoice
        ? `Genera un examen de opción múltiple con ${numQuestions} preguntas y ${numOptions} opciones, basado en el material.`
        : `Genera 3 preguntas de desarrollo o ensayo abiertas y desafiantes basadas en el material, adecuadas para un nivel ${studentLevel}.`; 

    // Paso 2: Formulario de Submisión 
    if (isChallengeActive) {
        const isCorrected = currentChallenge.isCorrected;
        
        // 2A. Opción Múltiple (Interactiva)
        if (isMultipleChoice && currentChallenge.data && currentChallenge.data.questions) {
            
            const scoreText = isCorrected 
                ? `¡CORREGIDO! Obtuviste ${currentChallenge.score} de ${currentChallenge.total} (${currentChallenge.percentage.toFixed(0)}%)` 
                : `Progreso: ${totalMultipleChoiceAnswered} de ${totalQuestionsMC} respondidas.`;
                
            const isAllAnswered = totalMultipleChoiceAnswered === totalQuestionsMC;

            return (
                <div className="flex flex-col p-4 border-t bg-white shadow-lg">
                    <div className={`p-3 mb-4 rounded-lg font-bold text-center shadow-inner transition-colors duration-300 ${isCorrected ? (currentChallenge.percentage >= 60 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
                        <Award className="inline w-5 h-5 mr-2"/> {scoreText}
                    </div>

                    {/* Contenedor de preguntas con scroll */}
                    <div className="flex-1 overflow-y-auto max-h-[300px] sm:max-h-[400px] pr-2 space-y-8 p-4 rounded-xl bg-gray-50 border border-gray-200 shadow-inner">
                        <p className="font-extrabold text-xl text-indigo-700">{currentChallenge.data.title || "Examen Generado"}</p>
                        {currentChallenge.data.questions.map((q, qIndex) => {
                            const result = isCorrected ? currentChallenge.results.find(r => r.qIndex === qIndex) : null;
                            const isUserCorrect = result && result.isCorrect;
                            
                            // Determinar el borde y fondo de la pregunta
                            let questionClass = 'border-gray-300';
                            if (isCorrected) {
                                questionClass = isUserCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50';
                            }

                            return (
                                <div key={qIndex} className={`p-4 border-l-4 rounded-lg shadow-md transition-all duration-300 ${questionClass}`}>
                                    <p className="font-bold mb-3 text-gray-800 flex items-start">
                                        <span className={`inline-block mr-2 px-2 py-1 text-xs font-extrabold rounded-full ${isCorrected ? (isUserCorrect ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'bg-indigo-600 text-white'}`}>
                                            P{qIndex + 1}
                                        </span>
                                        {q.question}
                                    </p>
                                    <div className="space-y-2">
                                        {q.options.map((option, oIndex) => {
                                            const optionMatch = option.trim().match(/^([A-Z])[\.\)]?\s/i);
                                            const optionLetter = optionMatch ? optionMatch[1].toUpperCase() : String.fromCharCode(65 + oIndex); 
                                            
                                            const isSelected = userSelections[qIndex] === optionLetter;
                                            const isCorrectOption = optionLetter === q.correct_answer;
                                            
                                            let optionClass = 'hover:bg-indigo-100 border-transparent'; // Default (not corrected)
                                            if (isCorrected) {
                                                if (isCorrectOption) {
                                                    optionClass = 'bg-green-200 border-2 border-green-600 font-semibold';
                                                } else if (isSelected && !isCorrectOption) {
                                                    optionClass = 'bg-red-200 border-2 border-red-600 font-semibold opacity-80';
                                                } else {
                                                    optionClass = 'bg-gray-100 opacity-60'; 
                                                }
                                            } else {
                                                optionClass = isSelected ? 'bg-indigo-100 border-2 border-indigo-500' : 'bg-white hover:bg-gray-50 border border-gray-200';
                                            }


                                            return (
                                                <div 
                                                    key={oIndex} 
                                                    className={`flex items-center p-3 rounded-lg transition duration-150 shadow-sm ${isCorrected ? 'cursor-default' : 'cursor-pointer'} ${optionClass}`}
                                                    onClick={() => !isCorrected && handleSelectionChange(qIndex, optionLetter)}
                                                >
                                                    <div className="w-5 h-5 mr-3 flex items-center justify-center flex-shrink-0">
                                                        {isCorrected && isCorrectOption && <Check className="w-5 h-5 text-green-700" />}
                                                        {isCorrected && isSelected && !isCorrectOption && <X className="w-5 h-5 text-red-700" />}
                                                        {!isCorrected && isSelected && <span className="w-3 h-3 bg-indigo-600 rounded-full" />}
                                                    </div>
                                                    
                                                    <label className="text-sm font-medium text-gray-700 flex-1 cursor-inherit">
                                                        {option}
                                                    </label>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    
                    {!isCorrected && (
                        <button
                            onClick={handleSubmitChallenge}
                            className={`mt-4 w-full px-6 py-3 rounded-full text-white font-semibold transition duration-300 shadow-xl flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
                                isAllAnswered && !isGenerating ? 'bg-green-600 hover:bg-green-700' : 'bg-green-300 cursor-not-allowed'
                            }`}
                            disabled={!isAllAnswered || isGenerating}
                        >
                            {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                            Corregir Examen Ahora
                        </button>
                    )}
                </div>
            );
        }
        
        // 2B. Desarrollo (Caja de texto)
        if (currentView === View.EXAM_DEVELOPMENT) {
            return (
                <div className="p-4 border-t bg-white flex flex-col space-y-3 shadow-lg">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center"><Edit className="w-5 h-5 mr-2 text-indigo-600"/> Envía tu Desarrollo</h3>
                    {isCorrected && (
                        <div className="p-3 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium border border-indigo-200">
                            La corrección detallada del profesor (IA) se ha añadido a la conversación de abajo.
                        </div>
                    )}
                    <textarea
                        className="w-full p-4 border border-gray-300 rounded-xl shadow-inner focus:ring-indigo-500 focus:border-indigo-500 text-sm resize-y min-h-40 transition duration-150"
                        placeholder="Escribe aquí tus respuestas completas al examen de desarrollo..."
                        value={userSubmission}
                        onChange={(e) => setUserSubmission(e.target.value)}
                        disabled={isGenerating || isCorrected}
                    />
                    {!isCorrected && (
                        <button
                            onClick={handleSubmitChallenge}
                            className={`w-full px-6 py-3 rounded-full text-white font-semibold transition duration-300 shadow-xl flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
                                userSubmission.trim() && !isGenerating ? 'bg-green-600 hover:bg-green-700' : 'bg-green-300 cursor-not-allowed'
                            }`}
                            disabled={!userSubmission.trim() || isGenerating}
                        >
                            {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                            Enviar para Corrección (IA)
                        </button>
                    )}
                </div>
            );
        }
    }

    // Paso 1: Botón de Generación de Desafío y Configuraciones
    return (
        <div className="flex flex-col space-y-4 p-4 border-t bg-gray-50 shadow-inner">
            <div className="flex flex-col space-y-3 sm:flex-row items-center justify-center sm:space-y-0 sm:space-x-4">
            
                {/* Controles de Configuración */}
                <div className="flex flex-wrap gap-3 bg-white p-4 rounded-xl shadow-md w-full justify-center">
                    <label className="text-gray-700 font-bold flex items-center text-sm"><Settings className="w-4 h-4 mr-1"/> Ajustes del Examen:</label>
                    
                    {isMultipleChoice && (
                        <>
                            <div className="flex items-center space-x-2">
                                <label className="text-gray-600 text-sm"># Preguntas:</label>
                                <select 
                                    value={numQuestions} 
                                    onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                                    className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm focus:ring-indigo-500"
                                    disabled={!isReadyForAction}
                                >
                                    {[3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                                <label className="text-gray-600 text-sm"># Opciones:</label>
                                <select 
                                    value={numOptions} 
                                    onChange={(e) => setNumOptions(parseInt(e.target.value))}
                                    className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm focus:ring-indigo-500"
                                    disabled={!isReadyForAction}
                                >
                                    {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                        </>
                    )}

                    {currentView === View.EXAM_DEVELOPMENT && (
                        <div className="flex items-center space-x-2">
                             <label className="text-gray-600 text-sm">Nivel:</label>
                            <select 
                                value={studentLevel} 
                                onChange={(e) => setStudentLevel(e.target.value)}
                                className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm focus:ring-indigo-500"
                                disabled={!isReadyForAction}
                            >
                                <option value="Básico">Básico</option>
                                <option value="Intermedio">Intermedio</option>
                                <option value="Avanzado">Avanzado</option>
                            </select>
                        </div>
                    )}
                </div>
            </div>
            
            <button
                onClick={() => generateChallenge(isMultipleChoice ? 'multiple' : 'development', actionPrompt)}
                className={`w-full px-6 py-3 rounded-full text-white font-bold transition duration-300 shadow-xl flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
                    isReadyForAction ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-300 cursor-not-allowed'
                } ${isGenerating ? 'opacity-70' : ''}`}
                disabled={!isReadyForAction}
            >
                {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
                Generar {isMultipleChoice ? 'Examen Múltiple' : 'Examen de Desarrollo'}
            </button>
        </div>
    );
  };


  // --- SUB-COMPONENTES DE INTERFAZ GENERAL ---

  const TabButton = ({ label, view, icon: Icon }) => {
    const isActive = view === currentView; 
    return (
      <button
        onClick={() => {
            setCurrentView(view);
            setCurrentChallenge(null); 
            setUserSubmission('');
            setUserSelections({});
        }} 
        className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 transition duration-200 rounded-t-lg whitespace-nowrap ${
          isActive
            ? 'border-indigo-600 text-indigo-700 font-bold bg-white shadow-t-lg' 
            : 'border-transparent text-gray-600 hover:text-indigo-600 hover:border-indigo-400'
        }`}
        disabled={isGenerating}
      >
          <Icon className="w-4 h-4 mr-2" />
          {label}
      </button>
    );
  };
  
  const FileUploadControl = () => {
    
    const fileExtension = file ? file.name.split('.').pop().toLowerCase() : '';
    const isText = fileExtension === 'txt';
    const FileIcon = file ? (isText ? FileText : Image) : Upload;

    return (
      <div className="p-4 border-b bg-white flex flex-col sm:flex-row items-center justify-between shadow-lg space-y-3 sm:space-y-0">
        
        <div className="flex-1 w-full flex flex-col sm:flex-row items-center justify-start space-x-0 sm:space-x-3 space-y-3 sm:space-y-0">
          {file ? (
            <div className="flex items-center space-x-3 w-full sm:w-auto p-2 bg-indigo-50 rounded-lg border border-indigo-200 shadow-inner flex-shrink-0">
              <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
              <span className="text-sm font-semibold text-gray-700 truncate min-w-0 flex-1">
                <FileIcon className="inline w-4 h-4 mr-1 text-indigo-500" />
                {file.name} 
              </span>
              <button onClick={clearFile} className="text-red-500 hover:text-red-700 p-1 rounded-full flex-shrink-0 transition duration-150" title="Borrar Material y Chat">
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="text-sm font-medium text-gray-600 w-full sm:w-auto">
              <span className="text-indigo-600 font-bold">Paso 1:</span> Sube tu material de estudio (.txt, .jpg, .png)
            </div>
          )}
        </div>
        
        <button 
          onClick={() => fileInputRef.current.click()} 
          className={`flex items-center justify-center px-6 py-2 text-sm rounded-full font-semibold transition duration-300 shadow-md transform hover:scale-[1.05] active:scale-[0.98] w-full sm:w-auto ${
            isGenerating || file || currentChallenge
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-indigo-500 text-white hover:bg-indigo-600'
          }`}
          title="Subir Archivo"
          disabled={isGenerating || file || currentChallenge} 
        >
          <Upload className="w-4 h-4 mr-2"/>
          {file ? 'Cambiar Material' : 'Subir Material'}
        </button>
        
        <input
          type="file"
          accept=".txt,image/jpeg,image/png" 
          onChange={handleFileChange}
          className="hidden"
          ref={fileInputRef}
          disabled={isGenerating}
        />
      </div>
    );
  };


  // --- RENDERIZADO PRINCIPAL ---
  
  return (
    <div className="flex flex-col h-screen w-full font-sans bg-gray-100 p-2 sm:p-4">
      
      {/* Contenedor Principal */}
      <div className="flex flex-col h-full bg-white shadow-2xl rounded-xl overflow-hidden border border-gray-200">
        
        {/* Pestañas de Navegación */}
        <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50 p-2 sm:p-0">
          <TabButton label="Examen Múltiple" view={View.EXAM_MULTIPLE} icon={Zap}/>
          <TabButton label="Examen de Desarrollo" view={View.EXAM_DEVELOPMENT} icon={Edit}/>
          <TabButton label="Resumen" view={View.SUMMARY} icon={BookOpen}/>
          <TabButton label="Flashcards" view={View.FLASHCARDS} icon={Layers}/>
          <div className="ml-auto hidden sm:flex items-center text-sm text-gray-500 px-4 py-2">
              <Bot className="w-4 h-4 mr-2 text-indigo-400" />
              Tutor Impulsado por Gemini
          </div>
        </div>
        
        {/* Control de Subida de Archivo (Fijo) */}
        <FileUploadControl />

        {/* Área de Visualización (Chat) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-50">
          {chatHistory.length === 0 ? (
            <div className="text-center text-gray-500 py-10">
              <Bot className="w-12 h-12 mx-auto mb-4 text-indigo-500" />
              <p className="text-lg font-semibold text-gray-700">¡Bienvenido a tu Tutor de Estudio Personalizado!</p>
              <p className="mt-2 text-sm">Sube tu material y selecciona una pestaña para comenzar a estudiar de forma interactiva.</p>
            </div>
          ) : (
            chatHistory.map((msg, index) => (
              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[95%] md:max-w-[75%] lg:max-w-[65%] p-4 rounded-xl shadow-lg transition-all duration-200 border ${
                  msg.role === 'user' 
                    ? (msg.isSubmission ? 'bg-green-50 text-gray-800 rounded-br-none border-green-300' : 'bg-indigo-600 text-white rounded-br-none')
                    : (msg.isError ? 'bg-red-50 text-red-800 rounded-tl-none border-red-300' : 'bg-white text-gray-800 rounded-tl-none border-gray-200')
                }`}>
                  
                  {/* Etiqueta de Material */}
                  {msg.file && (
                    <p className={`font-semibold text-xs mb-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-gray-500'}`}>
                      {msg.file.type.startsWith('image/') ? <Image className="inline w-3 h-3 mr-1"/> : <FileText className="inline w-3 h-3 mr-1"/>} 
                      {msg.role === 'user' ? 'Enviado sobre: ' : 'Generado sobre: '} {msg.file.name}
                    </p>
                  )}
                  
                  {/* Etiqueta de Corrección (Score) */}
                  {msg.correctionData && msg.correctionData.type === 'correction' && (
                       <p className={`font-extrabold text-sm mb-2 ${msg.correctionData.percentage >= 60 ? 'text-green-700' : 'text-red-700'} flex items-center`}>
                          <Award className="w-4 h-4 mr-1"/>
                          Resultado: {msg.correctionData.score} de {msg.correctionData.total} ({msg.correctionData.percentage.toFixed(0)}%)
                       </p>
                  )}
                  
                  {/* Contenido del Mensaje */}
                  <div className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }} />
                </div>
              </div>
            ))
          )}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="max-w-4xl p-4 rounded-xl shadow-md bg-white rounded-tl-none border border-gray-200 animate-pulse-slow">
                <div className="flex items-center space-x-2 text-gray-500">
                  <Loader className="w-5 h-5 animate-spin"/>
                  <span>La IA está trabajando...</span>
                </div>
              </div>
            </div>
          )}
          {currentChallenge && (
             <div className="flex justify-center w-full py-4">
                <p className="px-4 py-2 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-full text-sm font-medium shadow-md text-center">
                    ¡{currentChallenge.type === 'multiple' ? 'Responde las preguntas de arriba' : 'Escribe tus respuestas abajo'} y pulsa el botón verde!
                </p>
             </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Controles de Acción por Pestaña */}
        {renderInputControls()}
      </div>
      
      {/* Componente Toast para Notificaciones */}
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: null })} />
    </div>
  );
};

export default App;