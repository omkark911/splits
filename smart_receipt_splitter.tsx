import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  UploadCloud, 
  FileText, 
  Users, 
  CheckCircle2, 
  Circle, 
  RefreshCw, 
  AlertCircle, 
  ChevronRight,
  CheckCheck,
  Receipt,
  Euro,
  DollarSign,
  PoundSterling,
  Copy
} from 'lucide-react';

const CURRENCIES = [
  { id: 'EUR', symbol: '€', label: 'Euro (€)' },
  { id: 'USD', symbol: '$', label: 'US Dollar ($)' },
  { id: 'GBP', symbol: '£', label: 'British Pound (£)' },
  { id: 'INR', symbol: '₹', label: 'Indian Rupee (₹)' }
];

const COLORS = [
  'bg-blue-100 border-blue-500 text-blue-700 hover:bg-blue-50',
  'bg-emerald-100 border-emerald-500 text-emerald-700 hover:bg-emerald-50',
  'bg-violet-100 border-violet-500 text-violet-700 hover:bg-violet-50',
  'bg-amber-100 border-amber-500 text-amber-700 hover:bg-amber-50',
  'bg-pink-100 border-pink-500 text-pink-700 hover:bg-pink-50',
  'bg-cyan-100 border-cyan-500 text-cyan-700 hover:bg-cyan-50'
];

export default function SmartReceiptSplitter() {
  const [phase, setPhase] = useState('input'); // 'input', 'processing', 'split'
  const [error, setError] = useState(null);

  // --- Phase 1: Input State ---
  const [inputType, setInputType] = useState('image'); // 'image' or 'text'
  const [inputText, setInputText] = useState('');
  const [inputFile, setInputFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [participantsStr, setParticipantsStr] = useState('');
  const [currency, setCurrency] = useState('EUR');

  // --- Phase 3: Split State ---
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState({}); // { itemId: [participantNames] }
  const [copied, setCopied] = useState(false);

  const activeCurrency = CURRENCIES.find(c => c.id === currency) || CURRENCIES[0];
  const participants = useMemo(() => 
    participantsStr.split(',').map(s => s.trim()).filter(Boolean),
  [participantsStr]);

  // Helper to convert file to base64
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve({
        data: reader.result.split(',')[1],
        mimeType: file.type
    });
    reader.onerror = reject;
  });

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setInputFile(file);
      const url = URL.createObjectURL(file);
      setFilePreview(url);
    }
  };

  const startProcessing = async () => {
    if (inputType === 'image' && !inputFile) {
      setError('Please upload an image or PDF of the receipt.');
      return;
    }
    if (inputType === 'text' && !inputText.trim()) {
      setError('Please paste the receipt text.');
      return;
    }
    if (participants.length === 0) {
      setError('Please provide at least one participant.');
      return;
    }
    
    setError(null);
    setPhase('processing');

    try {
      let contents = [];
      const prompt = `Extract all line items and their prices from the provided receipt. Translate the item names to English (if they are in German or another language). Ignore totals, sub-totals, and taxes unless they are explicitly standalone items meant to be split (like a bag fee or discount). Return a JSON array.`;

      if (inputType === 'image') {
        const base64File = await toBase64(inputFile);
        contents = [{
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: base64File.mimeType, data: base64File.data } }
          ]
        }];
      } else {
        contents = [{
          role: "user",
          parts: [{ text: `${prompt}\n\nReceipt Text:\n${inputText}` }]
        }];
      }

      const payload = {
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                "name": { type: "STRING" },
                "originalName": { type: "STRING" },
                "price": { type: "NUMBER" }
              },
              required: ["name", "originalName", "price"]
            }
          }
        }
      };

      const apiKey = ""; // Canvas will automatically inject the key
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error.message || 'API Error');
      }

      const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!jsonText) throw new Error("Failed to parse response from AI.");
      
      const parsedItems = JSON.parse(jsonText);
      
      // Assign IDs to items and set initial assignments
      const formattedItems = parsedItems.map((item, index) => ({
        id: `item-${index}`,
        ...item
      }));
      
      const initialAssignments = {};
      formattedItems.forEach(item => { initialAssignments[item.id] = []; });
      
      setItems(formattedItems);
      setAssignments(initialAssignments);
      setPhase('split');

    } catch (err) {
      console.error(err);
      setError(err.message || "An unexpected error occurred while processing the receipt.");
      setPhase('input');
    }
  };

  // --- Splitting Math Logic ---
  // Calculates EXACT cent distribution ensuring sum equals item price
  const exactShares = useMemo(() => {
    const sharesByItem = {};
    const totalsByPerson = {};
    participants.forEach(p => totalsByPerson[p] = 0);
    let totalAssigned = 0;

    items.forEach(item => {
      const assignedTo = assignments[item.id] || [];
      sharesByItem[item.id] = {};
      
      if (assignedTo.length > 0) {
        const totalCents = Math.round(item.price * 100);
        const count = assignedTo.length;
        const baseShareCents = Math.trunc(totalCents / count);
        const remainderCents = totalCents - (baseShareCents * count);
        
        assignedTo.forEach((person, index) => {
          let shareCents = baseShareCents;
          // Distribute remainder 1 cent at a time
          if (index < Math.abs(remainderCents)) {
            shareCents += Math.sign(remainderCents);
          }
          const shareVal = shareCents / 100;
          sharesByItem[item.id][person] = shareVal;
          totalsByPerson[person] += shareVal;
          totalAssigned += shareVal;
        });
      }
    });

    return { sharesByItem, totalsByPerson, totalAssigned };
  }, [items, assignments, participants]);

  const receiptTotal = useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);

  const toggleParticipant = (itemId, person) => {
    setAssignments(prev => {
      const current = prev[itemId] || [];
      if (current.includes(person)) {
        return { ...prev, [itemId]: current.filter(p => p !== person) };
      } else {
        return { ...prev, [itemId]: [...current, person] };
      }
    });
  };

  const selectAll = (itemId) => {
    setAssignments(prev => {
      const current = prev[itemId] || [];
      if (current.length === participants.length) {
        return { ...prev, [itemId]: [] }; // Deselect all if already all selected
      }
      return { ...prev, [itemId]: [...participants] };
    });
  };

  const getPersonColorClass = (person, isActive) => {
    const index = participants.indexOf(person);
    const colorClassString = COLORS[index % COLORS.length];
    
    if (isActive) {
       // Return the active classes (bg, border, text)
       return colorClassString.replace('hover:', 'active-state-'); // strip hover for active
    }
    // Return inactive state (grayed out)
    return 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50';
  };

  const generateSummaryText = () => {
    let text = `🧾 Receipt Split Summary\nTotal: ${activeCurrency.symbol}${receiptTotal.toFixed(2)}\n\n`;
    participants.forEach(person => {
      const total = exactShares.totalsByPerson[person] || 0;
      if (total === 0) return;
      text += `👤 ${person}: ${activeCurrency.symbol}${total.toFixed(2)}\n`;
      items.forEach(item => {
        const share = exactShares.sharesByItem[item.id]?.[person];
        if (share !== undefined && share !== null && share !== 0) {
          text += `   - ${item.name}: ${activeCurrency.symbol}${share.toFixed(2)}\n`;
        }
      });
      text += `\n`;
    });
    return text.trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateSummaryText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- Rendering ---
  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-48">
      
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600">
            <Receipt className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight">SmartSplit</span>
          </div>
          {phase === 'split' && (
            <button 
              onClick={() => { setPhase('input'); setItems([]); }}
              className="text-sm font-medium text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Start Over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* ================= PHASE 1: INPUT ================= */}
        {phase === 'input' && (
          <div className="max-w-xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className="text-center">
              <h1 className="text-3xl font-extrabold text-gray-900">Upload Receipt</h1>
              <p className="mt-2 text-gray-500">We'll extract the items, translate them, and help you split the bill exactly.</p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 space-y-6">
              
              {/* Input Type Tabs */}
              <div className="flex p-1 bg-gray-100 rounded-lg">
                <button
                  onClick={() => setInputType('image')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-all ${inputType === 'image' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <UploadCloud className="w-4 h-4" /> Image / PDF
                </button>
                <button
                  onClick={() => setInputType('text')}
                  className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-all ${inputType === 'text' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <FileText className="w-4 h-4" /> Paste Text
                </button>
              </div>

              {/* Input Area */}
              <div className="pt-2">
                {inputType === 'image' ? (
                  <div className="space-y-4">
                    <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {filePreview ? (
                           <img src={filePreview} alt="Preview" className="h-24 object-contain mb-3 opacity-80" />
                        ) : (
                          <UploadCloud className="w-10 h-10 mb-3 text-gray-400" />
                        )}
                        <p className="mb-2 text-sm text-gray-500">
                          <span className="font-semibold">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-gray-500">PNG, JPG or PDF</p>
                      </div>
                      <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileChange} />
                    </label>
                    {inputFile && <p className="text-sm text-center text-green-600 font-medium">Loaded: {inputFile.name}</p>}
                  </div>
                ) : (
                  <textarea
                    rows={6}
                    className="w-full rounded-xl border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-4 border placeholder-gray-400"
                    placeholder="Paste receipt text here..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                  />
                )}
              </div>

              {/* Settings */}
              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Participants (comma separated) *</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Users className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="e.g. Alice, Bob, Charlie"
                      value={participantsStr}
                      onChange={(e) => setParticipantsStr(e.target.value)}
                    />
                  </div>
                  {participants.length === 0 && (
                    <p className="mt-1 text-xs text-orange-500">Please enter at least one participant.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                  <select
                    className="block w-full pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-lg bg-white"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={startProcessing}
                disabled={participants.length === 0}
                className={`w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-xl text-white bg-indigo-600 transition-colors shadow-sm ${
                  participants.length === 0 
                    ? 'opacity-50 cursor-not-allowed' 
                    : 'hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500'
                }`}
              >
                Analyze Receipt <ChevronRight className="w-5 h-5 ml-1 -mr-1" />
              </button>

            </div>
          </div>
        )}

        {/* ================= PHASE 2: PROCESSING ================= */}
        {phase === 'processing' && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-6 animate-in fade-in duration-300">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              <Receipt className="absolute inset-0 m-auto w-8 h-8 text-indigo-600 animate-pulse" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-gray-900">Processing Receipt...</h2>
              <p className="text-gray-500 text-sm max-w-sm">
                Our AI is reading the line items, extracting exact prices, and translating everything to English.
              </p>
            </div>
          </div>
        )}

        {/* ================= PHASE 3: SPLITTING ================= */}
        {phase === 'split' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
            
            <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-200">
               <div>
                 <h2 className="text-lg font-bold text-gray-900">Assign Items</h2>
                 <p className="text-sm text-gray-500">Tap participants to split the cost evenly.</p>
               </div>
               <div className="text-right">
                 <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Receipt Total</p>
                 <p className="text-xl font-extrabold text-gray-900">{activeCurrency.symbol}{receiptTotal.toFixed(2)}</p>
               </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {items.map((item) => {
                const assignedTo = assignments[item.id] || [];
                const allSelected = assignedTo.length === participants.length;
                const isDiscount = item.price < 0;

                return (
                  <div key={item.id} className="p-4 sm:p-5 hover:bg-gray-50/50 transition-colors">
                    
                    <div className="flex justify-between items-start mb-3 gap-4">
                      <div>
                        <h3 className={`font-semibold text-base ${isDiscount ? 'text-green-600' : 'text-gray-900'}`}>
                          {item.name}
                        </h3>
                        {item.originalName && item.originalName !== item.name && (
                          <p className="text-xs text-gray-400 font-medium italic mt-0.5">{item.originalName}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-lg font-bold ${isDiscount ? 'text-green-600' : 'text-gray-900'}`}>
                          {activeCurrency.symbol}{item.price.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <button
                        onClick={() => selectAll(item.id)}
                        className={`
                          px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors flex items-center gap-1
                          ${allSelected 
                            ? 'bg-gray-900 border-gray-900 text-white' 
                            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'}
                        `}
                      >
                        {allSelected ? <CheckCheck className="w-3.5 h-3.5" /> : null}
                        All
                      </button>
                      
                      <div className="w-px h-6 bg-gray-200 mx-1"></div>

                      {participants.map((person) => {
                        const isActive = assignedTo.includes(person);
                        const exactShare = isActive ? exactShares.sharesByItem[item.id][person] : null;

                        return (
                          <button
                            key={person}
                            onClick={() => toggleParticipant(item.id, person)}
                            className={`
                              relative flex items-center pl-2 pr-3 py-1.5 border rounded-lg text-sm font-medium transition-all duration-200 select-none
                              ${getPersonColorClass(person, isActive)}
                            `}
                          >
                            <span className="mr-1.5 flex-shrink-0">
                              {isActive ? (
                                <CheckCircle2 size={16} className="fill-current text-white stroke-current" />
                              ) : (
                                <Circle size={16} className="text-gray-400" />
                              )}
                            </span>
                            <span className="truncate max-w-[100px]">{person.split(' ')[0]}</span>
                            {isActive && exactShare !== null && (
                              <span className="ml-2 pl-2 border-l border-current opacity-80 text-xs font-bold">
                                {activeCurrency.symbol}{exactShare.toFixed(2)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                  </div>
                );
              })}
              
              {items.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                  No items found. Please try again with a clearer image or text.
                </div>
              )}
            </div>

            {/* SUMMARY EXPORT SECTION */}
            {items.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-8">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" /> Export Summary
                  </h3>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
                  >
                    {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="p-4 bg-gray-900 text-gray-100 overflow-x-auto">
                  <pre className="text-sm font-mono whitespace-pre-wrap">
                    {generateSummaryText()}
                  </pre>
                </div>
              </div>
            )}
            
          </div>
        )}
      </main>

      {/* ================= STICKY FOOTER (SPLIT PHASE ONLY) ================= */}
      {phase === 'split' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-15px_40px_-15px_rgba(0,0,0,0.1)] z-50 animate-in slide-in-from-bottom-full duration-500">
          <div className="max-w-4xl mx-auto p-4 sm:px-6 lg:px-8">
            
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                Final Split <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
              </h2>
              
              <div className="text-xs font-medium">
                {Math.abs(exactShares.totalAssigned - receiptTotal) < 0.01 ? (
                  <span className="text-green-600 bg-green-50 px-2 py-1 rounded-md border border-green-100 flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" /> Fully Assigned
                  </span>
                ) : (
                  <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded-md border border-orange-100">
                    Unassigned: {activeCurrency.symbol}{(receiptTotal - exactShares.totalAssigned).toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 snap-x hide-scrollbar">
              {participants.map((person, index) => {
                const total = exactShares.totalsByPerson[person] || 0;
                const colorStr = COLORS[index % COLORS.length];
                // Extract primary color name from the tailwind class string for styling
                const colorName = colorStr.split('-')[1]; 

                return (
                  <div 
                    key={person} 
                    className={`snap-center shrink-0 w-32 bg-${colorName}-50 rounded-xl p-3 border border-${colorName}-100 flex flex-col justify-center`}
                  >
                    <span className={`text-xs font-semibold text-${colorName}-700 truncate mb-0.5`}>
                      {person}
                    </span>
                    <span className={`text-xl font-black text-${colorName}-900`}>
                      {activeCurrency.symbol}{total.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}
      
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
}