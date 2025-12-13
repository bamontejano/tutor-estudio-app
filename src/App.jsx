import React, { useState, useEffect, useRef, useCallback } from 'react';

// Constantes de Firebase para la inicialización
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Importaciones de Firebase (Asumidas disponibles en el entorno Canvas)
// Nota: En un entorno de desarrollo real, se importaría desde 'firebase/app', 'firebase/auth', etc.
// Aquí se asume que las funciones están disponibles globalmente o se inicializan de forma similar
// al HTML, pero usamos la estructura de React para la inyección de dependencias.

// Placeholder de Inicialización de Firebase (ya que React se compila en un entorno que lo simula)
// Estas variables contendrán las instancias de Firebase una vez inicializadas.
let app = null;
let db = null;
let auth = null;

// --- Funciones Auxiliares de API de Gemini ---

// Importante: No se usa la clave API aquí. El entorno Canvas la inyecta.
const API_KEY = ""; 
const MODEL_NAME = "gemini-2.5-flash-preview-09-2025";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

// Función de retardo con retroceso exponencial
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetries = async (url, options, maxRetries = 5) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                // Manejar errores HTTP (4xx, 5xx)
                const errorBody = await response.json();
                throw new Error(`HTTP error! Status: ${response.status}, Details: ${JSON.stringify(errorBody)}`);
            }
            return response;
        } catch (error) {
            console.error(`Fetch attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1) throw error; // Re-lanza el error después del último intento
            const waitTime = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await delay(waitTime); // Retroceso exponencial con jitter
        }
    }
};


/**
 * Llama a la API de Gemini para generar contenido basado en un prompt y material de estudio.
 * @param {string} prompt El prompt de la IA.
 * @param {Object | null} fileData Los datos del archivo cargado, si existen.
 * @param {string} systemInstruction La instrucción del sistema para guiar la respuesta.
 * @param {string} responseMimeType El tipo MIME de la respuesta esperada (por ejemplo, "text/plain" o "application/json").
 * @param {Object | null} responseSchema El esquema JSON si se espera una respuesta estructurada.
 * @returns {Promise<string | Object>} El texto generado o el objeto JSON parseado.
 */
const generateContent = async (prompt, fileData, systemInstruction, responseMimeType = 'text/plain', responseSchema = null) => {
    const contents = [];

    // 1. Agregar el prompt de texto
    contents.push({ role: "user", parts: [{ text: prompt }] });

    // 2. Agregar los datos del archivo (si existen)
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
        systemInstruction: { parts: [{ text: systemInstruction }] },
    };

    if (responseMimeType.startsWith("application/json") && responseSchema) {
        payload.generationConfig = {
            responseMimeType: responseMimeType,
            responseSchema: responseSchema,
        };
    }

    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    };

    try {
        const response = await fetchWithRetries(API_URL, options);
        const result = await response.json();
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const text = candidate.content.parts[0].text;
            
            if (responseMimeType.startsWith("application/json")) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    console.error("Error al parsear la respuesta JSON:", e);
                    // Retorna el texto plano si el parseo falla
                    return text; 
                }
            }
            return text;
        } else {
            const errorMessage = result.error?.message || "Error desconocido al generar contenido.";
            throw new Error(errorMessage);
        }
    } catch (e) {
        console.error("Error en la llamada a la API:", e);
        throw new Error(`Error en la generación de la IA: ${e.message}`);
    }
};

// --- Definiciones de Esquemas JSON (para Examen de Opción Múltiple) ---

const quizSchema = {
    type: "OBJECT",
    properties: {
        title: {
            type: "STRING",
            description: "Un título breve y atractivo para el cuestionario."
        },
        questions: {
            type: "ARRAY",
            description: "Una lista de 5 preguntas de opción múltiple generadas a partir del material de estudio.",
            items: {
                type: "OBJECT",
                properties: {
                    question: {
                        type: "STRING",
                        description: "¿Qué pregunta se le hace al usuario?"
                    },
                    options: {
                        type: "ARRAY",
                        items: { type: "STRING" },
                        description: "Cuatro opciones de respuesta, de las cuales solo una es correcta."
                    },
                    correctAnswerIndex: {
                        type: "INTEGER",
                        description: "El índice (0 a 3) de la opción correcta en el array 'options'."
                    },
                    explanation: {
                        type: "STRING",
                        description: "Una breve explicación de por qué esta es la respuesta correcta."
                    }
                },
                required: ["question", "options", "correctAnswerIndex", "explanation"]
            }
        }
    },
    required: ["title", "questions"]
};

// --- Componente de Botones para Opciones de Estudio ---

const StudyOptions = React.memo(({ onSelectOption, isGenerating, materialLoaded, darkMode }) => {
    const baseClasses = "py-2 px-4 rounded-lg font-medium transition-all duration-200 shadow-lg";
    const enabledClasses = "bg-blue-600 hover:bg-blue-700 text-white transform hover:scale-[1.02]";
    const disabledClasses = "bg-gray-400 dark:bg-gray-600 text-gray-200 cursor-not-allowed";

    return (
        <div className={`p-4 rounded-xl shadow-inner ${darkMode ? 'bg-gray-800 border border-blue-900' : 'bg-gray-100'}`}>
            <h3 className={`text-lg font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                Elige tu Modo de Estudio:
            </h3>
            <div className="flex flex-wrap gap-3">
                <button
                    onClick={() => onSelectOption('Resumen', "Genera un resumen detallado y conciso del material proporcionado.")}
                    disabled={isGenerating || !materialLoaded}
                    className={`${baseClasses} ${isGenerating || !materialLoaded ? disabledClasses : enabledClasses}`}
                >
                    Resumir Material
                </button>
                <button
                    onClick={() => onSelectOption('Puntos Clave', "Extrae los 5 puntos clave más importantes y formatéalos como una lista numerada.")}
                    disabled={isGenerating || !materialLoaded}
                    className={`${baseClasses} ${isGenerating || !materialLoaded ? disabledClasses : enabledClasses}`}
                >
                    Puntos Clave
                </button>
                <button
                    onClick={() => onSelectOption('Examen Múltiple', "Genera un cuestionario de 5 preguntas de opción múltiple (con 4 opciones cada una) basado estrictamente en el material, y devuelve la respuesta en formato JSON según el esquema proporcionado.")}
                    disabled={isGenerating || !materialLoaded}
                    className={`${baseClasses} ${isGenerating || !materialLoaded ? disabledClasses : enabledClasses}`}
                >
                    Generar Examen (JSON)
                </button>
                <button
                    onClick={() => onSelectOption('Analogía', "Genera una analogía creativa y un ejemplo para explicar el concepto central del material.")}
                    disabled={isGenerating || !materialLoaded}
                    className={`${baseClasses} ${isGenerating || !materialLoaded ? disabledClasses : enabledClasses}`}
                >
                    Explicar con Analogía
                </button>
            </div>
        </div>
    );
});


// --- Componente de Carga de Archivos ---

const FileUploader = React.memo(({ onFileLoad, isGenerating, darkMode }) => {
    const fileInputRef = useRef(null);
    const baseClasses = "w-full py-2 px-4 rounded-lg font-medium transition-colors duration-200 border-2 border-dashed";
    const activeClasses = "border-blue-500 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:border-blue-600";
    const defaultClasses = "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-500";
    const disabledClasses = "border-gray-400 dark:border-gray-700 text-gray-500 cursor-not-allowed bg-gray-50 dark:bg-gray-900";


    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        // El lector debe manejar el formato base64
        reader.onload = (e) => {
            const base64String = e.target.result.split(',')[1];
            const mimeType = file.type;

            onFileLoad({
                name: file.name,
                mimeType: mimeType,
                base64Data: base64String,
                text: mimeType.startsWith('text/') ? atob(base64String) : `[Material cargado: ${file.name}]`
            });
        };

        // Leer el archivo como Data URL (que incluye el base64)
        reader.readAsDataURL(file);
    };

    return (
        <div className={`p-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-bold mb-3 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                Sube tu Material de Estudio
            </h3>
            <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Soporte para PDF, TXT, Markdown, o imágenes (JPG, PNG).
            </p>
            <button
                onClick={() => fileInputRef.current.click()}
                disabled={isGenerating}
                className={`${baseClasses} ${isGenerating ? disabledClasses : (darkMode ? activeClasses : defaultClasses)}`}
            >
                {isGenerating ? 'Procesando...' : 'Seleccionar Archivo (.pdf, .txt, .png, etc.)'}
            </button>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".txt, .md, .pdf, .jpg, .jpeg, .png"
                style={{ display: 'none' }}
                disabled={isGenerating}
            />
        </div>
    );
});

// --- Componente de Visualización de Chat ---

const ChatMessage = ({ message, darkMode }) => {
    const isUser = message.role === 'user';
    const bgColor = isUser 
        ? (darkMode ? 'bg-blue-600' : 'bg-blue-500') 
        : (darkMode ? 'bg-gray-700' : 'bg-white');
    const textColor = isUser ? 'text-white' : (darkMode ? 'text-gray-200' : 'text-gray-800');
    const alignment = isUser ? 'self-end' : 'self-start';
    const roleText = isUser ? 'Tú' : 'Tutor IA';

    // Función para manejar el formato de la respuesta (markdown simple)
    const formatText = (text) => {
        if (!text) return null;
        
        // Convertir negritas
        let formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Convertir itálicas
        formattedText = formattedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Convertir saltos de línea a <br>
        formattedText = formattedText.replace(/\n/g, '<br/>');

        return formattedText;
    };

    return (
        <div className={`flex flex-col mb-4 max-w-[85%] ${alignment}`}>
            <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {roleText}
            </div>
            <div 
                className={`p-4 rounded-2xl ${bgColor} ${textColor} shadow-md transition-all duration-300`}
                dangerouslySetInnerHTML={{ __html: formatText(message.text) }}
            />
        </div>
    );
};

// --- Componente Modal para el Examen ---

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
        
        // Preparar el resultado para enviar al chat
        const resultText = `¡Examen completado! Obtuviste **${currentScore} de ${challenge.questions.length}** correctas. A continuación, un desglose de tus respuestas:\n\n` + 
            challenge.questions.map((q, qIndex) => {
                const isCorrect = selectedAnswers[qIndex] === q.correctAnswerIndex;
                const userChoice = selectedAnswers[qIndex] !== undefined ? q.options[selectedAnswers[qIndex]] : "Sin responder";
                const correctness = isCorrect ? '✅ Correcta' : '❌ Incorrecta';
                
                return (
                    `**P${qIndex + 1}:** ${q.question}\n` +
                    `Tu respuesta: *${userChoice}* (${correctness})\n` +
                    `Explicación: ${q.explanation}\n`
                );
            }).join('\n---\n');
        
        // Enviar el resultado al componente principal (para el historial de chat)
        onSubmit(resultText);
    };

    const baseClasses = darkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-800';
    const borderClasses = darkMode ? 'border-blue-700' : 'border-blue-300';

    if (!challenge) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-70 backdrop-blur-sm">
            <div className={`w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl p-6 ${baseClasses}`}>
                <div className="flex justify-between items-center border-b pb-3 mb-4">
                    <h2 className="text-3xl font-extrabold text-blue-500">{challenge.title || "Examen de Opción Múltiple"}</h2>
                    <button 
                        onClick={onClose} 
                        className={`text-gray-400 hover:text-blue-500 transition-colors duration-200 text-3xl font-light`}
                    >
                        &times;
                    </button>
                </div>
                
                {submitted && (
                    <div className={`p-4 mb-4 rounded-lg text-center ${score === challenge.questions.length ? 'bg-green-100 dark:bg-green-900 text-green-700' : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700'}`}>
                        <h3 className="text-2xl font-bold">Puntuación: {score} / {challenge.questions.length}</h3>
                        <p className="mt-1">{score === challenge.questions.length ? "¡Felicidades, estudio perfecto!" : "Revisa tus respuestas para reforzar el aprendizaje."}</p>
                    </div>
                )}

                <div className="space-y-8">
                    {challenge.questions.map((q, qIndex) => (
                        <div key={qIndex} className={`p-5 rounded-lg border ${borderClasses} shadow-sm transition-all duration-300 ${submitted && selectedAnswers[qIndex] !== q.correctAnswerIndex && selectedAnswers[qIndex] !== undefined ? 'bg-red-900/10' : ''}`}>
                            <h4 className="text-lg font-semibold mb-3">
                                <span className="text-blue-500 mr-2">{qIndex + 1}.</span> {q.question}
                            </h4>
                            
                            <div className="space-y-2">
                                {q.options.map((option, oIndex) => {
                                    const isSelected = selectedAnswers[qIndex] === oIndex;
                                    const isCorrect = submitted && oIndex === q.correctAnswerIndex;
                                    const isIncorrectSelection = submitted && isSelected && !isCorrect;

                                    let optionClasses = `w-full text-left py-3 px-4 rounded-lg cursor-pointer transition-all duration-200 border-2 `;
                                    
                                    if (submitted) {
                                        if (isCorrect) {
                                            optionClasses += ' bg-green-500/20 border-green-500 font-bold';
                                        } else if (isIncorrectSelection) {
                                            optionClasses += ' bg-red-500/20 border-red-500 opacity-70';
                                        } else {
                                            optionClasses += ' border-gray-600/50 opacity-50';
                                        }
                                    } else {
                                        optionClasses += isSelected 
                                            ? ' bg-blue-500/20 border-blue-500 font-semibold' 
                                            : (darkMode ? ' border-gray-700 hover:border-blue-500' : ' border-gray-200 hover:bg-gray-50');
                                    }

                                    return (
                                        <div 
                                            key={oIndex}
                                            className={optionClasses}
                                            onClick={() => handleSelect(qIndex, oIndex)}
                                        >
                                            <span className="font-mono text-sm mr-2">{String.fromCharCode(65 + oIndex)}.</span> {option}
                                        </div>
                                    );
                                })}
                            </div>

                            {submitted && (
                                <p className={`mt-3 p-3 rounded-lg text-sm ${q.correctAnswerIndex === selectedAnswers[qIndex] ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                    **Explicación:** {q.explanation}
                                </p>
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-8 pt-4 border-t flex justify-end">
                    {!submitted ? (
                         <button 
                            onClick={handleSubmit} 
                            disabled={Object.keys(selectedAnswers).length < challenge.questions.length}
                            className="px-8 py-3 bg-green-600 text-white font-bold rounded-lg shadow-xl hover:bg-green-700 transition-colors disabled:bg-gray-500"
                        >
                            {Object.keys(selectedAnswers).length < challenge.questions.length 
                                ? `Responder (${Object.keys(selectedAnswers).length}/${challenge.questions.length})`
                                : 'Finalizar Examen y Ver Resultados'
                            }
                        </button>
                    ) : (
                        <button 
                            onClick={onClose} 
                            className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg shadow-xl hover:bg-blue-700 transition-colors"
                        >
                            Cerrar y Volver al Chat
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};


// --- Componente Principal de la Aplicación ---

export default function App() {
    // --- Estados de la Aplicación ---
    const [chatHistory, setChatHistory] = useState([]);
    const [fileData, setFileData] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [userInput, setUserInput] = useState('');
    const [currentChallenge, setCurrentChallenge] = useState(null); // Para guardar el examen JSON
    const [errorMessage, setErrorMessage] = useState(null);
    const [darkMode, setDarkMode] = useState(false); // Nuevo estado para Dark Mode

    const chatContainerRef = useRef(null);

    // --- Lógica de Dark Mode (Cargado desde localStorage al inicio) ---
    useEffect(() => {
        const isDark = localStorage.getItem('darkMode') === 'true';
        setDarkMode(isDark);
        if (isDark) {
            document.documentElement.classList.add('dark');
        }
    }, []);

    const toggleDarkMode = () => {
        setDarkMode(prev => {
            const newState = !prev;
            localStorage.setItem('darkMode', newState);
            if (newState) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            return newState;
        });
    };

    // --- Manejo de la Carga de Archivos ---

    const handleFileLoad = useCallback((data) => {
        setFileData(data);
        setChatHistory([
            { role: 'user', text: `[Archivo Cargado: ${data.name}]` },
            { role: 'model', text: `¡Material cargado con éxito! El archivo **${data.name}** está listo para el estudio. ¿Qué te gustaría hacer con él? Puedes pedir un resumen, puntos clave, o generar un examen de práctica.` }
        ]);
        setErrorMessage(null);
        setCurrentChallenge(null);
    }, []);

    // --- Scroll Automático del Chat ---

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory, currentChallenge]);

    // --- Lógica de Llamada a la IA ---

    const processChat = useCallback(async (prompt, systemInstruction, responseMimeType = 'text/plain', responseSchema = null) => {
        setIsGenerating(true);
        setErrorMessage(null);
        
        // Agregar el mensaje de usuario antes de la llamada
        setChatHistory(prev => [...prev, { role: 'user', text: prompt }]);

        try {
            const aiResponse = await generateContent(
                prompt, 
                fileData, 
                systemInstruction, 
                responseMimeType, 
                responseSchema
            );

            if (responseMimeType === 'application/json' && typeof aiResponse === 'object' && aiResponse !== null) {
                // Es un desafío estructurado (Examen Múltiple)
                setCurrentChallenge(aiResponse);
                setChatHistory(prev => [...prev, { role: 'model', text: `He generado un examen de **${aiResponse.questions.length} preguntas** basado en tu material. Por favor, toma el examen en la ventana modal que acaba de aparecer.` }]);
            } else {
                // Es una respuesta de texto normal
                setChatHistory(prev => [...prev, { role: 'model', text: aiResponse }]);
            }

        } catch (error) {
            console.error("Error en el procesamiento del chat:", error);
            setErrorMessage(error.message);
            setChatHistory(prev => [...prev, { role: 'model', text: `Lo siento, ocurrió un error: ${error.message}` }]);
        } finally {
            setIsGenerating(false);
        }
    }, [fileData]);

    // --- Manejo de Opciones de Estudio Predefinidas ---

    const handleSelectOption = (optionType, promptInstruction) => {
        if (!fileData) return setErrorMessage("Por favor, sube un archivo primero.");
        
        const fileDescription = fileData.text.length > 500 ? 
            fileData.text.substring(0, 500) + '...' : fileData.text;

        const systemPrompt = `Actúa como un tutor de estudio experto. Tu tarea es analizar el material proporcionado y cumplir con la solicitud. ${optionType === 'Examen Múltiple' ? 'Si la solicitud es un examen, debes DEVOLVER ESTRICTAMENTE UN OBJETO JSON que cumpla con el esquema provisto.' : ''}`;

        const userPrompt = `Material de estudio: "${fileDescription}". Basado estrictamente en este material, por favor: ${promptInstruction}`;
        
        if (optionType === 'Examen Múltiple') {
            processChat(userPrompt, systemPrompt, 'application/json', quizSchema);
        } else {
            processChat(userPrompt, systemPrompt);
        }
    };

    // --- Manejo de Preguntas de Chat Abiertas ---

    const handleSendChat = (e) => {
        e.preventDefault();
        if (!userInput.trim() || isGenerating) return;

        const systemPrompt = "Actúa como un tutor de estudio. Responde concisa y útilmente a la pregunta del usuario. Refiérete al material que te proporcionaron anteriormente si es relevante.";
        
        // Si hay un archivo cargado, incluir una referencia a él en el prompt
        const promptWithContext = fileData 
            ? `(Material Cargado: ${fileData.name}). Pregunta: ${userInput}`
            : userInput;

        processChat(promptWithContext, systemPrompt);
        setUserInput('');
    };

    // --- Lógica del Modal de Examen ---

    const handleExamClose = () => {
        setCurrentChallenge(null);
    };

    const handleExamSubmit = (resultText) => {
        // Al enviar, agregamos el resultado del examen al historial de chat
        setChatHistory(prev => [...prev, { role: 'user', text: "He completado el examen generado." }]);
        setChatHistory(prev => [...prev, { role: 'model', text: resultText }]);
        setCurrentChallenge(null); // Cierra el modal
    };


    // --- Renderizado ---

    const mainBg = darkMode ? 'bg-gray-900' : 'bg-gray-50';
    const textColor = darkMode ? 'text-gray-100' : 'text-gray-800';
    const headerBg = darkMode ? 'bg-gray-800 border-b border-gray-700' : 'bg-white shadow-md';
    const inputBg = darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-300';
    const buttonBg = darkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600';


    return (
        <div className={`min-h-screen flex flex-col antialiased ${mainBg} ${textColor}`}>
            <style jsx global>{`
                /* Font-face for Inter is usually handled by the host environment */
                body { font-family: 'Inter', sans-serif; }
                .dark {
                    /* Tailwind dark mode base */
                    --tw-bg-opacity: 1;
                    background-color: rgb(17 24 39 / var(--tw-bg-opacity)); /* bg-gray-900 */
                }
            `}</style>
            
            {/* Encabezado Fijo */}
            <header className={`sticky top-0 z-40 p-4 ${headerBg} flex justify-between items-center`}>
                <h1 className="text-2xl font-extrabold text-blue-500">
                    📚 Gemini Study Tutor
                </h1>
                <button 
                    onClick={toggleDarkMode}
                    className="p-2 rounded-full transition-colors duration-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    title={darkMode ? "Activar Modo Claro" : "Activar Modo Oscuro"}
                >
                    {/* Icono de Sol / Luna (Lucide React no disponible, usando SVG/Emoji) */}
                    {darkMode ? (
                        <span className="text-xl">☀️</span> // Sol
                    ) : (
                        <span className="text-xl">🌙</span> // Luna
                    )}
                </button>
            </header>

            <main className="flex-grow container mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Columna de Controles (Fija) */}
                <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-20 h-fit">
                    <FileUploader onFileLoad={handleFileLoad} isGenerating={isGenerating} darkMode={darkMode} />
                    
                    <StudyOptions 
                        onSelectOption={handleSelectOption} 
                        isGenerating={isGenerating} 
                        materialLoaded={!!fileData}
                        darkMode={darkMode}
                    />

                    {fileData && (
                        <div className={`p-4 rounded-xl shadow-lg ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
                            <h3 className={`text-lg font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                Material Activo
                            </h3>
                            <p className="text-sm truncate text-blue-500 font-medium">
                                {fileData.name}
                            </p>
                            <button
                                onClick={() => setFileData(null)}
                                className="mt-2 text-xs text-red-500 hover:text-red-600 font-medium"
                            >
                                Quitar Material
                            </button>
                        </div>
                    )}
                </div>

                {/* Columna de Chat (Principal) */}
                <div className="lg:col-span-2 flex flex-col h-[75vh] lg:h-[85vh]">
                    <div 
                        ref={chatContainerRef}
                        className={`flex-grow overflow-y-auto p-4 space-y-4 rounded-xl shadow-inner ${darkMode ? 'bg-gray-800' : 'bg-gray-100'} transition-colors duration-300`}
                    >
                        {chatHistory.length === 0 ? (
                            <div className={`text-center p-10 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <h2 className="text-xl font-semibold mb-2">¡Bienvenido a tu Tutor IA!</h2>
                                <p>Sube un documento o imagen para empezar a estudiar y generar resúmenes, puntos clave o exámenes.</p>
                            </div>
                        ) : (
                            chatHistory.map((msg, index) => (
                                <ChatMessage key={index} message={msg} darkMode={darkMode} />
                            ))
                        )}

                        {/* Indicador de Carga MEJORADO */}
                        {isGenerating && (
                            <div className={`flex flex-col mb-4 max-w-[85%] self-start`}>
                                <div className={`text-xs mb-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Tutor IA
                                </div>
                                <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-white'} shadow-md`}>
                                    <div className="flex items-center space-x-3">
                                        <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                            Generando respuesta...
                                        </span>
                                    </div>
                                    {/* Simulación de Barra de Progreso (UX visual) */}
                                    <div className="mt-2 w-full bg-blue-200 rounded-full h-1.5 dark:bg-blue-900">
                                        <div 
                                            className="bg-blue-600 h-1.5 rounded-full animate-pulse" 
                                            style={{ width: '80%' }} // Simulación de progreso
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {errorMessage && (
                            <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                                <span className="font-bold">Error:</span> {errorMessage}
                            </div>
                        )}
                    </div>

                    {/* Área de Entrada de Chat */}
                    <form onSubmit={handleSendChat} className="mt-4 flex space-x-3">
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder={fileData ? "Haz una pregunta sobre el material..." : "Pregunta lo que quieras o sube un archivo primero..."}
                            className={`flex-grow p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${inputBg} ${textColor}`}
                            disabled={isGenerating}
                        />
                        <button
                            type="submit"
                            className={`flex-shrink-0 px-5 py-3 rounded-xl text-white font-semibold shadow-lg transition-colors duration-200 ${buttonBg} disabled:bg-gray-400`}
                            disabled={isGenerating || !userInput.trim()}
                        >
                            Enviar
                        </button>
                    </form>
                </div>
            </main>

            {/* Modal de Examen (Vista Separada) */}
            {currentChallenge && (
                <ExamModal 
                    challenge={currentChallenge} 
                    onClose={handleExamClose} 
                    onSubmit={handleExamSubmit}
                    darkMode={darkMode}
                />
            )}
        </div>
    );
}