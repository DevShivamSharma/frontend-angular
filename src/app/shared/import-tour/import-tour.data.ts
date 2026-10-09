export type ImportMode = 'pdf' | 'csv';
export interface TourLesson {
  id: string;
  stage: number;
  title: [string, string];
  tasks: [string[], string[]];
  tip: [string, string];
}
export const PDF_LESSONS: TourLesson[] = [
  {
    id: 'upload',
    stage: 0,
    title: ['Upload your plan', 'Plan upload karo'],
    tasks: [
      [
        'Open your venue, then Add hall → Import from floor plan.',
        'Click Choose file or drop a PDF, DXF, PNG or JPEG (up to 20 MB). Wait for Reading your floor plan to finish.',
        'If an older import still shows the wrong detection, open Upload options → Start a new review, then upload the file again.',
      ],
      [
        'Apna venue kholo, phir Add hall → Import from floor plan.',
        'Choose file se PDF, DXF, PNG ya JPEG upload karo (20 MB tak). Reading your floor plan khatam hone do.',
        'Purana galat result dobara aaye toh Upload options mein Start a new review tick karke file phir upload karo.',
      ],
    ],
    tip: [
      'A vector PDF or DXF gives clearer geometry. Keep a printed measurement available for scans.',
      'Vector PDF ya DXF se geometry zyada clear milti hai. Scan ke liye plan par likha koi measurement ready rakho.',
    ],
  },
  {
    id: 'choose',
    stage: 1,
    title: ['Choose actual halls', 'Sirf actual halls chuno'],
    tasks: [
      [
        'Compare each detected hall with the original image. Green is a hall; blue is a foyer or circulation area.',
        'Select the halls you need and click Review selected halls. Each one saves as a separate hall. A single hall opens Review directly.',
        'A foyer must stay linked to its hall, rather than being selected as another hall. If a shape has the wrong type, open its review → Adjust outline → Shape type.',
        'If a hall is missing, use Add a missing hall, click its boundary corners, and Finish outline.',
      ],
      [
        'Original plan se har detected hall milao. Hara hall hai; neela foyer ya circulation area.',
        'Jo halls chahiye unhe select karke Review selected halls dabao. Har hall alag save hoga. Single hall seedha Review mein khulta hai.',
        'Foyer ko alag hall select mat karo; uska type Foyer aur owner actual hall hona chahiye. Galat type ho toh Review → Adjust outline → Shape type kholo.',
        'Hall missing ho toh Add a missing hall dabao, boundary ke corners click karo aur Finish outline karo.',
      ],
    ],
    tip: [
      'Directions such as “FROM HALL…” describe neighbouring halls, not necessarily halls to import.',
      '“FROM HALL…” jaise labels neighbouring hall ki direction hain; zaroori nahi ki woh is plan ka hall ho.',
    ],
  },
  {
    id: 'outline',
    stage: 2,
    title: ['Review the hall outline', 'Hall ki boundary check karo'],
    tasks: [
      [
        'Use Original + outline. Scroll or + / − to zoom; drag to pan; Fit shows the complete plan.',
        'Check every edge, stepped corner and floor opening. The green outline should cover the hall’s actual floor.',
        'If correct, tick Hall outline is correct. If wrong, click Adjust outline, drag corners or Redraw selected outline, then Done.',
        'Corrections are applied automatically when you preview. Changing geometry requires another visual check.',
      ],
      [
        'Original + outline view rakho. Scroll ya + / − se zoom, drag se pan aur Fit se poora plan dekho.',
        'Har edge, stepped corner aur opening check karo. Hara outline actual hall floor ko cover kare.',
        'Sahi ho toh Hall outline is correct tick karo. Galat ho toh Adjust outline mein corners drag ya Redraw selected outline karo, phir Done.',
        'Preview karte waqt corrections apply hote hain. Geometry badle toh imported view phir check karna hoga.',
      ],
    ],
    tip: [
      'Checking a box confirms your inspection; it does not repair the detected boundary.',
      'Checkbox tumhari jaanch confirm karta hai; galat boundary khud repair nahi hoti.',
    ],
  },
  {
    id: 'foyers',
    stage: 2,
    title: ['Keep foyers separate and linked', 'Foyer ka type aur hall link sahi rakho'],
    tasks: [
      [
        'Under Check the outline, inspect each linked foyer’s blue boundary and its Linked to hall names.',
        'Tick the foyer confirmation only when both the boundary and owners are correct.',
        'For a wrong type or owner, click Add or link a foyer / Adjust foyer. Select its Shape, choose Shape type → Foyer, and tick the correct hall under Foyer belongs to. Click Done.',
        'For a missing foyer, choose Add foyer, click its corners, Finish outline, choose its owner and Done. A shared foyer can belong to several halls.',
      ],
      [
        'Check the outline ke andar har foyer ki neeli boundary aur Linked to hall names dekho.',
        'Boundary aur hall links dono sahi hon tab foyer confirmation tick karo.',
        'Galat type ya owner ho toh Add or link a foyer / Adjust foyer kholo. Shape chuno, Shape type → Foyer karo, Foyer belongs to mein sahi hall tick karo aur Done.',
        'Foyer missing ho toh Add foyer, corners click, Finish outline, owner choose aur Done karo. Shared foyer ko multiple halls se link kar sakte ho.',
      ],
    ],
    tip: [
      'A foyer can have the same grid as a hall. The grid alone does not make it a hall.',
      'Foyer mein bhi hall jaisi grid ho sakti hai. Grid hone se woh hall nahi ban jaata.',
    ],
  },
  {
    id: 'size',
    stage: 2,
    title: ['Establish metres and grid spacing', 'Size aur grid metres mein set karo'],
    tasks: [
      [
        'Check Hall size. If the scale is known, compare the dimensions with the source.',
        'For a square source grid with a printed cell size, enter Width of one grid square (metres), then Use this grid size. Do not assume every grid is 1 m.',
        'Otherwise click Measure a known distance: click both ends of a printed dimension, enter that distance in metres, and Set size.',
        'After setting size, enter Grid spacing (metres) and Set grid spacing to establish or correct a square grid. Use the spacing printed on the plan. For intentionally rectangular grids, use corrections → Advanced settings; Grid width / height there use source drawing units.',
      ],
      [
        'Hall size dekho aur source ke dimensions se milao.',
        'Square grid ka size plan par likha ho toh Width of one grid square (metres) bharo aur Use this grid size dabao. Har grid ko 1 m mat maano.',
        'Warna Measure a known distance dabao: printed dimension ke dono ends click karo, uski distance metres mein bharo aur Set size.',
        'Size set karne ke baad Grid spacing (metres) bharo aur Set grid spacing dabao. Square grid ke liye plan par likhi spacing use karo. Rectangular grid ho toh Advanced settings mein Grid width / height source drawing units mein set karo.',
      ],
    ],
    tip: [
      'Unknown scale blocks saving. Accepting a measurement warning cannot replace calibration.',
      'Scale unknown ho toh save block rahega. Measurement warning accept karna calibration ka replacement nahi hai.',
    ],
  },
  {
    id: 'restrictions',
    stage: 2,
    title: ['Review restrictions and facilities', 'Restricted areas aur facilities check karo'],
    tasks: [
      [
        'Compare columns, fire curtains, passages, exits and facilities with the original plan and its legend.',
        'For every uncertain coloured area, choose its actual Meaning. Use Drawing only only for a visual mark with no floor restriction.',
        'Use Correct an area to select, redraw, add or label a restriction / facility. Click Done after corrections.',
        'Tick Columns, exits and restricted areas are correct after inspection.',
      ],
      [
        'Columns, fire curtains, passages, exits aur facilities ko original plan aur legend se milao.',
        'Har uncertain colour ke liye actual Meaning chuno. Sirf visual mark ho, restriction nahi, tab Drawing only chuno.',
        'Correct an area se select, redraw, add ya label karo. Corrections ke baad Done dabao.',
        'Jaanch ke baad Columns, exits and restricted areas are correct tick karo.',
      ],
    ],
    tip: [
      'A colour is evidence to review, not an automatic permission to build stalls.',
      'Colour ko review karna hai; sirf colour dekhkar stall floor assume nahi hota.',
    ],
  },
  {
    id: 'checks',
    stage: 2,
    title: ['Resolve failed or missing checks', 'Pending checks resolve karo'],
    tasks: [
      [
        'Open measurements or warnings in the review panel. Compare Plan and Measured values with the original.',
        'If a printed area or dimension exists, link it using corrections → Advanced settings. If it is genuinely absent, explicitly confirm measurements are unavailable.',
        'For an overridable difference, inspect the source before accepting it. Boundary, unknown scale and uncertain restrictions require correction.',
        'Use the pending-actions list in this tour to see why your current hall cannot continue. Preview after changes to refresh the checks.',
      ],
      [
        'Review panel mein measurements ya warnings dekho. Plan aur Measured values original se milao.',
        'Area ya dimension printed hai toh corrections → Advanced settings se link karo. Source mein hai hi nahi tab measurements unavailable confirm karo.',
        'Accept karne layak difference ho toh source dekh kar accept karo. Boundary, unknown scale aur uncertain restrictions ko correct karna hoga.',
        'Tour ki pending-actions list batayegi current hall kyun continue nahi kar sakta. Changes ke baad Preview se checks refresh karo.',
      ],
    ],
    tip: [
      'A missing measurement is not shown as a successful automatic check.',
      'Missing measurement ko successful automatic check nahi dikhaya jaata.',
    ],
  },
  {
    id: 'preview',
    stage: 2,
    title: ['Inspect the imported result', 'Imported result aankhon se check karo'],
    tasks: [
      [
        'Click Preview imported hall / Imported hall. Inspect the resulting grid, outer boundary, holes, foyers and restrictions in Three.js.',
        'Tick The imported hall looks correct only after inspecting that result.',
        'Click Review next hall for another selected hall, or Continue to save for the last one.',
        'Each hall needs its own confirmation. Editing a boundary, foyer, scale or shared area can require affected halls to be inspected again.',
      ],
      [
        'Preview imported hall / Imported hall dabao. Three.js mein final grid, boundary, holes, foyer aur restrictions dekho.',
        'Result check karne ke baad The imported hall looks correct tick karo.',
        'Agla hall ho toh Review next hall; last hall ho toh Continue to save dabao.',
        'Har hall ki alag confirmation chahiye. Boundary, foyer, scale ya shared area badle toh affected halls phir inspect karne honge.',
      ],
    ],
    tip: [
      'To update an existing hall, choose its Save destination and inspect the added / removed floor overlay.',
      'Existing hall update karna ho toh Save destination chuno aur added / removed floor overlay check karo.',
    ],
  },
  {
    id: 'save',
    stage: 3,
    title: ['Save each reviewed hall', 'Reviewed halls save karo'],
    tasks: [
      [
        'Check hall names, dimensions and foyer areas on Ready to save your halls.',
        'Save hall / Save N halls stores every selected hall separately. Wait for the saved links.',
        'If one hall fails, its error remains visible. Finish that hall’s review and retry; already saved halls are retained.',
        'Open saved hall or Go to venue to view the imported result. You can download a configuration from the export option.',
      ],
      [
        'Ready to save your halls par names, dimensions aur foyer areas dekho.',
        'Save hall / Save N halls se selected halls alag save hote hain. Saved links aane do.',
        'Koi hall fail ho toh uska error dekho, review finish karke retry karo. Jo save ho chuke hain woh retained rahenge.',
        'Open saved hall ya Go to venue se result dekho. Export option se configuration download kar sakte ho.',
      ],
    ],
    tip: [
      'A disabled Save button means at least one selected hall still needs inspection or a check resolved.',
      'Save disabled hai toh selected halls mein kisi ki inspection ya check pending hai.',
    ],
  },
];
export const CSV_LESSONS: TourLesson[] = [
  {
    id: 'upload',
    stage: 0,
    title: ['Upload venue CSV', 'Venue CSV upload karo'],
    tasks: [
      [
        'Open Add hall → Import from CSV and choose a .csv file (up to 12 MB).',
        'A file can contain one hall or several halls. A row is one hall, or one space of a hall (outline, foyer, pillar, stall) grouped by its hall column. Layout exports and generic rectangle / polygon columns are recognised; cells may contain JSON geometry and annotations.',
        'Wait for the converted hall list. Per-hall errors tell you which mapping is missing.',
      ],
      [
        'Add hall → Import from CSV kholo aur .csv file chuno (12 MB tak).',
        'Ek row ek hall ho sakti hai, ya hall ki ek space (outline, foyer, pillar, stall) jo hall column se group hoti hai. Layout exports aur rectangle / polygon columns supported hain; cells mein JSON geometry aur annotations ho sakte hain.',
        'Converted hall list aane do. Har hall ka error batayega kaunsi mapping missing hai.',
      ],
    ],
    tip: [
      'Unsupported canvas paths need a polygon export rather than guessed geometry.',
      'Unsupported canvas paths ke liye polygon export chahiye; geometry guess nahi hoti.',
    ],
  },
  {
    id: 'mapping',
    stage: 1,
    title: ['Repair units and field mapping', 'Units aur fields ki mapping karo'],
    tasks: [
      [
        'Open Units and field mapping if a hall has an error. Choose Rows in this file, then source units; pixel data needs Metres per source unit.',
        'Each field shows the column it reads (Automatic: suggested by name). Choose another column if a suggestion is wrong; required fields are marked, and Columns in this file shows what every column is read as.',
        'Use Custom area fields for unusual area positions / dimensions. Use Area meanings (Space types for one row per space) for unknown types or colours.',
        'Click Update preview after any change. Earlier visual confirmations are cleared.',
      ],
      [
        'Hall mein error ho toh Units and field mapping kholo. Pehle Rows in this file chuno, phir source units; pixels ke liye Metres per source unit chahiye.',
        'Har field dikhata hai woh kaunsa column padhta hai (Automatic: naam se suggest). Galat ho toh dusra column chuno; required fields marked hain, aur Columns in this file batata hai har column kaise padha gaya.',
        'Unusual area fields ke liye Custom area fields aur unknown colour/type ke liye Area meanings (one row per space mein Space types) use karo.',
        'Change ke baad Update preview dabao. Purani visual confirmations clear ho jayengi.',
      ],
    ],
    tip: [
      'Automatic works only when the source supplies recognised fields and units.',
      'Automatic tabhi kaam karta hai jab source mein recognised fields aur units hon.',
    ],
  },
  {
    id: 'choose',
    stage: 1,
    title: ['Select halls independently', 'Halls alag select karo'],
    tasks: [
      [
        'Select the halls you want to save. Click each hall’s name to open its preview.',
        'A foyer belongs inside its hall’s converted floor, not as a separate hall record. Map Foyers to the source zone array when needed.',
        'Existing source identities appear as Update or Already up to date. Check the destination before saving.',
      ],
      [
        'Jo halls save karne hain select karo. Har hall ka naam click karke preview kholo.',
        'Foyer us hall ke converted floor mein aayega, alag hall record nahi. Zaroorat ho toh Foyers field ko source zone array se map karo.',
        'Existing source identity par Update ya Already up to date dikhega. Save se pehle destination check karo.',
      ],
    ],
    tip: [
      'You can select one hall to save individually or review several for a batch save.',
      'Ek hall select karke alag save ya multiple halls review karke batch save kar sakte ho.',
    ],
  },
  {
    id: 'preview',
    stage: 1,
    title: ['Review converted geometry', 'Converted geometry check karo'],
    tasks: [
      [
        'Use Fit, scroll to zoom and drag to pan in the Three.js preview.',
        'Compare hall dimensions, boundary, foyers and restrictions with the source. Correct mapping and Update preview if they differ.',
        'Check The converted hall, foyers and restrictions look correct for this hall. Repeat for every selected hall.',
        'Download converted JSON if you want to inspect the canonical output before saving.',
      ],
      [
        'Three.js preview mein Fit, scroll se zoom aur drag se pan karo.',
        'Dimensions, boundary, foyers aur restrictions source se milao. Farak ho toh mapping correct karke Update preview karo.',
        'Is hall ke liye The converted hall, foyers and restrictions look correct tick karo. Har selected hall par repeat karo.',
        'Save se pehle canonical output chahiye toh Download converted JSON dabao.',
      ],
    ],
    tip: [
      'Mapping changes require a new preview and confirmation for every affected selected hall.',
      'Mapping badalne par naya preview aur selected halls ki confirmation phir chahiye.',
    ],
  },
  {
    id: 'save',
    stage: 1,
    title: ['Save converted halls', 'Converted halls save karo'],
    tasks: [
      [
        'Enter the hall name for a new hall. Check existing updates before committing.',
        'Once all selected previews are confirmed, click Save N hall(s). Wait for created / updated / already up to date results.',
        'Click Done to return to the venue. An unchanged repeat import does not create another floor version.',
      ],
      [
        'New hall ka naam bharo. Existing update ko commit se pehle check karo.',
        'Sab selected previews confirm hon toh Save N hall(s) dabao. Created / updated / already up to date result aane do.',
        'Done se venue par wapas aao. Unchanged repeat import se extra floor version nahi banta.',
      ],
    ],
    tip: [
      'If a saved hall changed since preview, refresh the preview and inspect again.',
      'Preview ke baad saved hall badla ho toh preview refresh karke phir inspect karo.',
    ],
  },
];
