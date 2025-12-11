import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, FileText, Image, Bot, Loader, X, Zap, Edit, BookOpen, Layers, Check, AlertTriangle, Send, Settings } from 'lucide-react';

// CONFIGURACIÓN DE LA API DE GEMINI
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; 
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

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
        reader.onload = () => resolve(reader.result.split(',')[1]); // Solo queremos la parte base64
        reader.onerror = error => reject(error);
    });
};

// --- COMPONENTE PRINCIPAL ---
const App = () => {
  // --- ESTADO DE LA APLICACIÓN ---
  const [currentView, setCurrentView] = useState(View.EXAM_MULTIPLE);
  const [errorMessage, setErrorMessage] = useState(null); 
  
  // Estados del archivo cargado
  const [file, setFile] = useState(null);
  const [fileContent, setFileContent] = useState(''); // Contenido de texto O base64 de la imagen
  const [fileType, setFileType] = useState(null); // 'text/plain', 'image/jpeg', 'image/png'
  const [isFileContentReady, setIsFileContentReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Estados de configuración de examen
  const [numQuestions, setNumQuestions] = useState(3); 
  const [numOptions, setNumOptions] = useState(4);
  const [studentLevel, setStudentLevel] = useState('Intermedio'); 
  
  // ESTADOS para el flujo de 2 pasos (Desafío)
  const [currentChallenge, setCurrentChallenge] = useState(null); 
  const [userSubmission, setUserSubmission] = useState('');       
  const [userSelections, setUserSelections] = useState({});       
  const [chatHistory, setChatHistory] = useState([]); // Historial de chat local
  
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);
  
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
    
    setErrorMessage(null);
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
        setErrorMessage("El archivo es demasiado grande. Máximo 5MB.");
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
                // Para imágenes, convertimos a Base64 para la API
                const base64Data = await getBase64Image(selectedFile);
                setFileContent(base64Data);
            } else {
                // Para texto, usamos el contenido directo
                setFileContent(e.target.result);
            }
            setIsFileContentReady(true);
        } catch (error) {
            setErrorMessage(`Error al procesar el archivo: ${error.message}`);
            setFile(null);
            setFileContent('');
        }
    };
    
    reader.onerror = () => {
      setErrorMessage("Error de lectura del archivo. Asegúrate de que no esté corrupto.");
      setFile(null);
      setFileContent('');
    };

    if (isImage) {
        reader.readAsDataURL(selectedFile); // Necesitamos DataURL para getBase64Image
    } else {
        reader.readAsText(selectedFile);
    }
  };

  const clearFile = () => {
    setFile(null);
    setFileContent('');
    setFileType(null);
    setErrorMessage(null); 
    setIsFileContentReady(false);
    setCurrentChallenge(null);
    setUserSubmission('');
    setUserSelections({});
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; 
    }
  };
  
  // --- GESTIÓN DEL HISTORIAL DE CHAT (Local) ---
  const saveMessage = useCallback((role, text, isSubmission = false, isError = false, challengeData = null) => {
      const message = {
          role,
          text,
          timestamp: Date.now(),
          isSubmission: !!isSubmission,
          isError: !!isError,
          file: file ? { name: file.name, type: fileType } : null,
          ...(challengeData && { jsonChallenge: challengeData }) 
      };
      
      setChatHistory(prev => [...prev, message]);
  }, [file, fileType]);


  // --- LÓGICA DE LLAMADA A GEMINI (Con Backoff) ---

  const handleGeminiCall = useCallback(async (userPrompt, isCorrection = false, structuredSchema = null, maxRetries = 3) => {
    if (!file || !isFileContentReady) throw new Error('El material no está cargado.');
    
    let systemInstruction;

    // 1. Construir el prompt para la IA
    let parts = [];

    if (isCorrection) {
        // En corrección, el prompt es el texto de las respuestas/selecciones del usuario
        let challengeDataText = '';
        if (currentChallenge.type === 'multiple') {
            challengeDataText = `Preguntas del Examen:\n${JSON.stringify(currentChallenge.data.questions)}\nRespuestas del usuario:\n${JSON.stringify(userSelections)}`;
        } else {
            challengeDataText = `Preguntas de Desarrollo:\n${currentChallenge.data}\nRespuestas del usuario:\n${userSubmission}`;
        }
        
        systemInstruction = "Actúa como un profesor experto y conciso. Proporciona una corrección detallada, una puntuación (inventada, ej: 85/100) y un feedback constructivo. Muestra las respuestas correctas o puntos clave para mejorar. Base la corrección estrictamente en el material adjunto.";
        parts.push({ text: `Por favor, evalúa y corrige las siguientes respuestas proporcionadas por el usuario, basándote en el material de estudio adjunto y el desafío original. ${challengeDataText}` });

    } else {
        // En generación (Examen, Resumen, Flashcards), el prompt incluye el contexto del material
        if (fileType.startsWith('image/')) {
            // Instrucción específica para imágenes
            systemInstruction = "Actúa como un tutor de estudio experto. Analiza la imagen proporcionada como material de estudio. Tu tarea es generar la solicitud del usuario (examen, resumen, flashcards, etc.) basándote ÚNICAMENTE en la información visible o el texto detectado en la imagen.";
            parts.push({ text: userPrompt });
            parts.push({
                inlineData: {
                    mimeType: fileType,
                    data: fileContent
                }
            });
        } else {
            // Instrucción para texto plano
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

    // Configuración para salida estructurada (JSON)
    if (structuredSchema) {
        payload.generationConfig = {
            responseMimeType: "application/json",
            responseSchema: structuredSchema
        };
    }

    // 2. Guardar mensaje del usuario en el historial local
    const userMessageText = isCorrection 
        ? (currentChallenge?.type === 'multiple' ? `Respuestas seleccionadas: ${JSON.stringify(userSelections, null, 2)}` : `Respuestas enviadas:\n\n${userSubmission}`)
        : userPrompt;
    
    saveMessage("user", userMessageText, isCorrection);
    
    // 3. Llamada con Backoff Exponencial
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) { // Tasa Limitada
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
                
                // Procesar JSON si aplica
                let challengeData = null;
                if (structuredSchema) {
                    try {
                        challengeData = JSON.parse(textResult);
                    } catch (e) {
                        console.error("Error al parsear JSON de la IA:", e, textResult);
                        throw new Error("La IA no devolvió un JSON válido para el examen.");
                    }
                }
                
                // Guardar la respuesta del modelo
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
  }, [saveMessage, file, isFileContentReady, fileContent, fileType, currentChallenge, userSelections, userSubmission, numQuestions, numOptions]); 

  // --- CONTROLADORES DE FLUJO (Mismos que antes, solo llaman al GeminiCall actualizado) ---

  const generateOneStepContent = useCallback(async (actionPrompt) => {
    setIsGenerating(true);
    setCurrentChallenge(null); 
    setUserSubmission('');
    setUserSelections({});
    
    try {
        await handleGeminiCall(actionPrompt, false, null); 
    } catch (error) {
        setErrorMessage(`Error de la API: ${error.message || "Ocurrió un error inesperado al procesar tu solicitud."}`);
        saveMessage("model", `ERROR: La llamada a la API falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, false, true);
    } finally {
        setIsGenerating(false);
        setTimeout(() => setErrorMessage(null), 8000);
    }
  }, [handleGeminiCall, saveMessage]);


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
            setCurrentChallenge({ type, data: parsedJson, userPrompt: prompt });

            const initialSelections = {};
            if (parsedJson.questions) {
                parsedJson.questions.forEach((_, index) => {
                    initialSelections[index] = null;
                });
            }
            setUserSelections(initialSelections);
        } else {
            setCurrentChallenge({ type, data: generatedContent, userPrompt: prompt });
        }

    } catch (error) {
        setErrorMessage(`Error de la API: ${error.message || "Ocurrió un error inesperado al procesar tu solicitud."}`);
        saveMessage("model", `ERROR: La llamada a la API falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, false, true);
    } finally {
        setIsGenerating(false);
        setTimeout(() => setErrorMessage(null), 8000);
    }
  }, [handleGeminiCall, saveMessage]); 

  const submitForCorrection = useCallback(async () => {
    if (!currentChallenge) return;
    
    setIsGenerating(true);
    try {
        await handleGeminiCall("Solicitud de corrección de examen", true, null);
        
        setCurrentChallenge(null);
        setUserSubmission('');
        setUserSelections({});

    } catch (error) {
        setErrorMessage(`Error de la API: ${error.message || "Ocurrió un error inesperado al procesar tu solicitud."}`);
        saveMessage("model", `ERROR: La llamada a la API de corrección falló.\n\nMensaje: ${error.message || 'Error Desconocido'}`, true, true);
    } finally {
        setIsGenerating(false);
        setTimeout(() => setErrorMessage(null), 8000);
    }
  }, [handleGeminiCall, currentChallenge, saveMessage]); 

  const handleSelectionChange = useCallback((qIndex, optionLetter) => {
    setUserSelections(prev => ({
        ...prev,
        [qIndex]: optionLetter,
    }));
  }, []);
  
  const allMultipleChoiceAnswered = currentChallenge && currentChallenge.type === 'multiple'
    ? Object.keys(currentChallenge.data.questions || {}).every(key => userSelections[key] !== null)
    : false;


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
            <div className="p-4 border-t bg-gray-50 flex justify-center">
                <button
                    onClick={() => generateOneStepContent(prompt)}
                    className={`w-full sm:w-1/2 px-6 py-3 rounded-xl text-white font-semibold transition duration-150 shadow-lg flex items-center justify-center ${
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
        
        // 2A. Opción Múltiple (Interactiva)
        if (currentChallenge.type === 'multiple' && currentChallenge.data && currentChallenge.data.questions) {
            return (
                <div className="flex flex-col p-4 border-t bg-white">
                    <h3 className="text-lg font-semibold mb-3 text-indigo-700 flex items-center">
                        <Settings className="w-5 h-5 mr-2" /> {currentChallenge.data.title || 'Examen de Opción Múltiple'}
                    </h3>
                    
                    {/* Contenedor de preguntas con scroll */}
                    <div className="flex-1 overflow-y-auto max-h-[300px] sm:max-h-[400px] pr-2 space-y-6 border p-3 rounded-lg bg-gray-50 shadow-inner">
                        {currentChallenge.data.questions.map((q, qIndex) => (
                            <div key={qIndex} className="p-3 border-b border-gray-200 last:border-b-0">
                                <p className="font-bold mb-2 text-gray-800">P{qIndex + 1}: {q.question}</p>
                                <div className="space-y-1">
                                    {/* Mapear Opciones */}
                                    {q.options.map((option, oIndex) => {
                                        const optionMatch = option.trim().match(/^([A-Z])[\.\)]?\s/i);
                                        const optionLetter = optionMatch ? optionMatch[1].toUpperCase() : String.fromCharCode(65 + oIndex); 
                                        
                                        const isSelected = userSelections[qIndex] === optionLetter;

                                        return (
                                            <div 
                                                key={oIndex} 
                                                className={`flex items-center p-2 rounded-md transition duration-100 cursor-pointer ${isSelected ? 'bg-indigo-100 border border-indigo-400' : 'hover:bg-indigo-50'}`}
                                                onClick={() => handleSelectionChange(qIndex, optionLetter)}
                                            >
                                                <input
                                                    type="radio"
                                                    id={`q${qIndex}-o${oIndex}`}
                                                    name={`question-${qIndex}`}
                                                    checked={isSelected}
                                                    onChange={() => handleSelectionChange(qIndex, optionLetter)}
                                                    className="form-radio h-4 w-4 text-indigo-600 transition duration-150 ease-in-out"
                                                    disabled={isGenerating}
                                                />
                                                <label htmlFor={`q${qIndex}-o${oIndex}`} className="ml-3 text-sm font-medium text-gray-700 flex-1">
                                                    {option}
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    <button
                        onClick={submitForCorrection}
                        className={`mt-4 w-full px-6 py-3 rounded-xl text-white font-semibold transition duration-150 shadow-lg flex items-center justify-center ${
                            allMultipleChoiceAnswered && !isGenerating ? 'bg-green-600 hover:bg-green-700' : 'bg-green-300 cursor-not-allowed'
                        }`}
                        disabled={!allMultipleChoiceAnswered || isGenerating}
                    >
                        {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                        Enviar Respuestas y Corregir
                    </button>
                </div>
            );
        }
        
        // 2B. Desarrollo (Caja de texto)
        if (currentChallenge.type === 'development') {
            return (
                <div className="p-4 border-t bg-gray-50 flex flex-col space-y-3">
                    <h3 className="text-lg font-semibold text-gray-700">Tus Respuestas al Examen de Desarrollo:</h3>
                    <textarea
                        className="w-full p-3 border border-gray-300 rounded-lg shadow-inner focus:ring-indigo-500 focus:border-indigo-500 text-sm resize-y min-h-32"
                        placeholder="Escribe aquí tus respuestas completas al examen de desarrollo..."
                        value={userSubmission}
                        onChange={(e) => setUserSubmission(e.target.value)}
                        disabled={isGenerating}
                    />
                    <button
                        onClick={submitForCorrection}
                        className={`w-full px-6 py-3 rounded-xl text-white font-semibold transition duration-150 shadow-lg flex items-center justify-center ${
                            userSubmission.trim() && !isGenerating ? 'bg-green-600 hover:bg-green-700' : 'bg-green-300 cursor-not-allowed'
                        }`}
                        disabled={!userSubmission.trim() || isGenerating}
                    >
                        {isGenerating ? <Loader className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                        Enviar para Corrección
                    </button>
                </div>
            );
        }
    }

    // Paso 1: Botón de Generación de Desafío y Configuraciones
    return (
        <div className="flex flex-col space-y-3 p-4 border-t bg-gray-50">
            <div className="flex flex-col space-y-3 sm:flex-row items-center justify-center sm:space-y-0 sm:space-x-4">
            
                {isMultipleChoice && (
                    <div className="flex flex-col space-y-2 sm:flex-row sm:space-x-4 sm:space-y-0 bg-white p-3 rounded-lg shadow-sm w-full sm:w-auto">
                        <label className="text-gray-700 text-sm font-medium flex items-center"><Settings className="w-4 h-4 mr-1"/> Configuración:</label>
                        
                        <div className="flex items-center space-x-2">
                          <label className="text-gray-700 text-sm font-medium">Preguntas:</label>
                          <select 
                              value={numQuestions} 
                              onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                              className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm w-full sm:w-auto"
                              disabled={!isReadyForAction}
                          >
                              {[1, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <label className="text-gray-700 text-sm font-medium">Opciones:</label>
                          <select 
                              value={numOptions} 
                              onChange={(e) => setNumOptions(parseInt(e.target.value))}
                              className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm w-full sm:w-auto"
                              disabled={!isReadyForAction}
                          >
                              {[2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                    </div>
                )}

                {currentView === View.EXAM_DEVELOPMENT && (
                    <div className="flex items-center space-x-4 bg-white p-3 rounded-lg shadow-sm w-full sm:w-auto justify-center">
                         <label className="text-gray-700 text-sm font-medium flex items-center"><Settings className="w-4 h-4 mr-1"/> Nivel:</label>
                        <select 
                            value={studentLevel} 
                            onChange={(e) => setStudentLevel(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg shadow-sm text-sm w-full sm:w-auto"
                            disabled={!isReadyForAction}
                        >
                            <option value="Básico">Básico (Primaria)</option>
                            <option value="Intermedio">Intermedio (Secundaria)</option>
                            <option value="Avanzado">Avanzado (Bachillerato/Universidad)</option>
                        </select>
                    </div>
                )}
            </div>
            
            <button
                onClick={() => generateChallenge(isMultipleChoice ? 'multiple' : 'development', actionPrompt)}
                className={`w-full px-6 py-3 rounded-xl text-white font-semibold transition duration-150 shadow-lg flex items-center justify-center ${
                    isReadyForAction ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-300 cursor-not-allowed'
                }`}
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
        className={`flex items-center px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition duration-150 rounded-t-lg whitespace-nowrap ${
          isActive
            ? 'border-indigo-600 text-indigo-700 font-semibold bg-white shadow-t-inner' 
            : 'border-transparent text-gray-600 hover:text-indigo-600 hover:border-indigo-300'
        }`}
        disabled={isGenerating}
      >
          <Icon className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          {label}
      </button>
    );
  };
  
  const FileUploadControl = () => {
    
    const fileExtension = file ? file.name.split('.').pop().toLowerCase() : '';
    const isText = fileExtension === 'txt';
    const FileIcon = file ? (isText ? FileText : Image) : Upload;

    return (
      <div className="p-4 border-t border-b bg-white flex flex-col sm:flex-row items-center justify-between shadow-md space-y-2 sm:space-y-0">
        
        {errorMessage && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-lg mb-2 w-full flex items-center text-sm">
            <AlertTriangle className="w-4 h-4 mr-2"/>
            {errorMessage}
          </div>
        )}

        <div className="flex-1 w-full sm:w-auto">
          {file ? (
            <div className="flex items-center space-x-3 w-full">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-700 truncate min-w-0 flex-1">
                <FileIcon className="inline w-4 h-4 mr-1 text-indigo-500" />
                {file.name} 
                {!isFileContentReady && (
                  <span className="ml-2 text-yellow-600 flex items-center">
                    <Loader className="w-4 h-4 animate-spin mr-1"/> Procesando...
                  </span>
                )}
              </span>
              <button onClick={clearFile} className="text-red-500 hover:text-red-700 p-1 rounded-full flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-500 w-full">
              {isGenerating 
                  ? "Generando contenido, espera un momento..." 
                  : "Paso 1: Sube tu material de estudio (.txt, .jpg, .png)" 
              }
            </div>
          )}
        </div>
        
        <button 
          onClick={() => fileInputRef.current.click()} 
          className={`flex items-center justify-center px-4 py-2 text-sm rounded-lg transition duration-150 shadow-sm w-full sm:w-auto ${
            isGenerating || file || currentChallenge
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-indigo-500 text-white hover:bg-indigo-600'
          }`}
          title="Subir Archivo"
          disabled={isGenerating || file || currentChallenge} 
        >
          <Upload className="w-4 h-4 mr-2"/>
          Subir Material
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
        <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50">
          <TabButton label="Examen Múltiple" view={View.EXAM_MULTIPLE} icon={Zap}/>
          <TabButton label="Examen de Desarrollo" view={View.EXAM_DEVELOPMENT} icon={Edit}/>
          <TabButton label="Resumen" view={View.SUMMARY} icon={BookOpen}/>
          <TabButton label="Flashcards" view={View.FLASHCARDS} icon={Layers}/>
          <div className="ml-auto flex items-center text-xs text-gray-500 px-2 sm:px-4 py-2">
              <Bot className="w-3 h-3 mr-1 text-indigo-400" />
              Tutor Multi-Formato (Local)
          </div>
        </div>
        
        {/* Control de Subida de Archivo (Fijo) */}
        <FileUploadControl />

        {/* Área de Visualización (Chat) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {chatHistory.length === 0 ? (
            <div className="text-center text-gray-500 py-10">
              <Bot className="w-10 h-10 mx-auto mb-2 text-indigo-400" />
              <p>Sube tu material (.txt, .jpg, o .png) y haz clic en la opción deseada para generar tu contenido de estudio.</p>
              <p className="text-xs mt-4">Nota: Esta versión usa la visión de Gemini para analizar imágenes y generar contenido a partir de ellas.</p>
            </div>
          ) : (
            chatHistory.map((msg, index) => (
              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[95%] md:max-w-[70%] lg:max-w-[60%] p-3 rounded-xl shadow-md ${
                  msg.role === 'user' 
                    ? (msg.isSubmission ? 'bg-green-100 text-gray-800 rounded-br-none border border-green-300' : 'bg-indigo-600 text-white rounded-br-none')
                    : (msg.isError ? 'bg-red-100 text-red-800 rounded-tl-none border border-red-400' : 'bg-white text-gray-800 rounded-tl-none border border-gray-200')
                }`}>
                  {msg.file && (
                    <p className={`font-semibold text-xs mb-1 ${msg.role === 'user' ? 'text-indigo-200' : 'text-gray-500'}`}>
                      {msg.file.type.startsWith('image/') ? <Image className="inline w-3 h-3 mr-1"/> : <FileText className="inline w-3 h-3 mr-1"/>} 
                      Material: {msg.file.name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-sm">
                    {/* Renderiza el texto del mensaje */}
                    {msg.text}
                  </p>
                </div>
              </div>
            ))
          )}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="max-w-4xl p-3 rounded-xl shadow-md bg-white rounded-tl-none border border-gray-200">
                <div className="flex items-center space-x-2 text-gray-500">
                  <Loader className="w-5 h-5 animate-spin"/>
                  <span>Generando respuesta de IA (Gemini)...</span>
                </div>
              </div>
            </div>
          )}
          {currentChallenge && (
             <div className="flex justify-center w-full py-4">
                <p className="px-4 py-2 bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-lg text-sm font-medium animate-pulse text-center">
                    ¡{currentChallenge.type === 'multiple' ? 'Selecciona tus respuestas' : 'Escribe tus respuestas'} y pulsa "Enviar para Corrección".
                </p>
             </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Controles de Acción por Pestaña */}
        {renderInputControls()}
      </div>
    </div>
  );
};

export default App;