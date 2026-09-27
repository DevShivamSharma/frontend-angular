# Stall Planner — Meeting Points (Hinglish)

Prepared: 27 September 2026. Scope: current Angular frontend implementation aur repository ka placement contract. Yeh code-review report hai; is report ke liye fresh browser tests, build ya live backend verification run nahi ki gayi.

## Meeting mein bolne ke liye opening

“Hamara stall planner hall ke usable floor, stall dimensions, open sides, passages aur restricted areas ko check karke placement allow karta hai. Add, draw, move, resize, rotate, duplicate aur assisted placement common validation rules follow karte hain. Invalid drop rollback hota hai, existing invalid layouts repair ke liye visible rehte hain, aur unresolved violations ke saath save block hota hai. Final persistence aur permanent stall numbering backend response se confirm hoti hai.”

## Current defaults aur configurable values

| Setting | Current behaviour |
|---|---|
| Measurement | Metres; area square metres mein |
| Event type | B2B aur B2C; initial selection B2B |
| Minimum stall passage | Dono event types ka missing-setting default 3 m; allowed configured range 3–5 m |
| Passage input | UI increment 0.5 m; validator finite value aur 3–5 m range check karta hai |
| External wall clearance | Default 1 m; hall rules se override ho sakta hai |
| Facility access, partition, smoke-curtain zone clearance | Default 1 m; specific zone clearance ko priority milti hai |
| Other zone buffers | Default extra buffer 0 m, lekin zone ke andar stall phir bhi prohibited |
| Door access depth | Explicit setting ho toh woh; otherwise current event passage width |
| Grid / size snap | Default 1 m / 1 m; hall rules configurable |
| Initial snap toggle | On |
| Add Shop form | Initial width 8 m, length 8 m, height 4 m; FRONT opening |
| New stall status | AVAILABLE |
| Number prefix | Default STALL-; permanent assignment server se |

Defaults ko har hall ki fixed value mat present karna: saved hall/zone configuration inhe override kar sakti hai.

## Existing rules aur workflows

1. **Sab halls par placement validation active hai.** Server halls, custom halls aur offline sample hall common rule engine use karte hain. Validation current hall ke stalls ke against hoti hai.

2. **Common coordinate system use hota hai.** Position stall ke centre ki hoti hai; X right aur Z plan mein down hai. Width local X aur length local Z par hai. Rotation clockwise degrees mein store hoti hai. FRONT/BACK/LEFT/RIGHT stall ke local sides hain aur rotation ke saath direction change hoti hai.

3. **Stall poora usable hall ke andar hona chahiye.** Rectangular, circular aur irregular outlines supported hain. Floor holes, walls, outside masks aur disconnected floor regions placement mein consider hote hain. Hall ka overall bounding rectangle akela valid floor nahi maana jata. Ek stall disconnected regions ke beech exterior space ko bridge nahi kar sakta.

4. **Dimensions positive aur configured snap-step ke multiples hone chahiye.** Default step 1 m hai. Add Shop dimensions ko nearest valid step par normalize karta hai, minimum ek step rakhta hai; edit mein invalid dimensions reject hoti hain. UI mein 0.5 m minimum dikhne se default 1 m grid par 2.5 m size automatically valid nahi ho jata.

5. **Snapping edges ke basis par hai.** Grid hall/plan ke minimum corner se align hoti hai. Odd-width stall ka centre half-metre par hona valid ho sakta hai, kyunki edges grid par hain. Move ka snap toggle position snapping control karta hai; width/length validation active rehti hai. Draw workflow apna grid-based footprint banata hai.

6. **Stall overlap prohibited hai.** AVAILABLE aur BOOKED stalls occupied space maane jate hain. CANCELLED stalls overlap, passage aur active-area checks se exclude hote hain. Distances edges/polygons se calculate hoti hain, centre-to-centre se nahi.

7. **Separate stalls ke beech selected passage maintain hona chahiye.** B2B/B2C ke liye 3–5 m setting stored ho sakti hai. Missing value 3 m hoti hai; explicitly saved invalid value ko silently valid default se replace nahi kiya jata. Passage/event setting badalne par current layout dobara audit hota hai; stalls automatically rearrange nahi hote.

8. **Har stall mein kam-se-kam ek open side zaroori hai.** Multiple open sides allowed hain, lekin last opening remove nahi ho sakti. Har open side ke full edge ke saamne selected passage jitni depth clear honi chahiye. Example: 4 m frontage aur 3 m passage setting par us frontage ka poora 4 m × 3 m access corridor check hota hai.

9. **Open-side access dono directions mein protect hota hai.** Candidate ki opening clear honi chahiye aur candidate existing stall ki opening bhi block nahi kar sakta. Walls, floor holes, outside area aur physical restricted zones ko clear passage nahi maana jata. Designated walkable passage/entry-exit zones access mein aa sakte hain, lekin un par stall place nahi ho sakta.

10. **Touching stalls ka exception strict back-to-back arrangement hai.** Dono stalls ke paas exactly ek open side ho, openings opposite outward directions mein hon, aur contact positive-length closed edge par ho. Sirf corner/point touch valid nahi. Corner stall involved ho toh yeh zero-gap exception allowed nahi hota.

11. **Corner classification actual floor geometry se hoti hai.** Do adjacent, non-collinear edges stall se selected passage distance ke andar hon toh corner rule lagta hai. Cut-outs aur obstacles ke corners relevant hain; smooth circular perimeter ko artificial rectangular corner nahi maana jata. Corner pair ko required passage chahiye; nearest-stall gap exterior se cross karke passage count nahi ho sakta.

12. **External walls ke paas peripheral clearance maintain hota hai.** Default 1 m hai. Yeh open-side access se alag check hai: wall ke paas opening ho toh us opening ke liye required 3–5 m corridor bhi fit hona chahiye. Circular hall mein outermost stall corners bhi boundary/clearance check mein aate hain.

13. **Restricted zones par construction blocked hai.** Supported types: compulsory PASSAGE, NO_CONSTRUCTION, EMERGENCY_EXIT_ACCESS, ENTRY_EXIT_ACCESS, FACILITY_ACCESS, restricted FOYER, PARTITION aur SMOKE_CURTAIN. Zone-specific buffer configured ho toh priority usko milti hai, otherwise hall ka zone-type buffer use hota hai. Hidden zone bhi placement restriction enforce karti hai.

14. **Entry, exit, service aur emergency openings clear rehni chahiye.** Opening ki width, position aur inward direction se access area banta hai. Depth explicitly configured ho sakti hai; otherwise event passage width use hoti hai. Stall is area ko overlap kare toh rejection hota hai. Valid opening metadata ka hona zaroori hai; sirf visual exit label automatic doorway clearance define nahi karta.

15. **Add aur Draw ke placement paths controlled hain.** Add Shop selected size/opening/rotation ke liye hall ke top-left origin ke nearest valid grid position ko search karta hai. Draw mein custom rectangle ya backend-configured size preview hota hai; release par valid footprint hi create hota hai. Space na mile toh failure explain hota hai, existing stalls move nahi kiye jate.

16. **Move, resize aur rotate par rules dobara check hote hain.** Drag mein stall pointer follow karta hai aur live problems show hoti hain. Invalid final drop original position par rollback hota hai. Typed X/Z placement bhi drop-style validation follow karti hai. Invalid resize, rotation ya opening change apply nahi hota. Quarter-turn command dimensions aur open sides swap karta hai; numeric rotation polygon-based check use karti hai.

17. **Duplicate bhi fresh placement hai.** Copy original ke upar insert nahi hoti; normal Add validation se free position milti hai. Copy naya AVAILABLE stall hota hai aur original ka permanent number reuse nahi karta.

18. **Feedback actionable hai.** Rule code, reason, affected area aur relevant stall context show hota hai. Locate camera ko problem par focus karta hai. Rejected move/draw ke liye same size/orientation ki nearby valid grid position milne par suggestion diya jata hai; user usse apply kar sakta hai. Clearances toggle visual overlay control karta hai, validation ko disable nahi karta.

19. **Free-space helper selected footprint ke liye hai.** Selected type, opening aur current rules ke basis par valid grid positions show hote hain; differing width/length ke orientations consider ho sakte hain. Displayed “fit” count alternative placements ka count hai, utne stalls simultaneously fit hone ki capacity guarantee nahi. Search grid-based hai; continuous-space global packing optimum ka claim nahi hai.

20. **AI Assist pehle proposal deta hai.** Current hall geometry, rules, event type aur existing stalls backend assistant ko send hote hain. Chat input limit 500 characters hai. Returned placements existing stalls aur proposal ke already accepted stalls ke against check hote hain. Apply se pehle outlines/fitting count review hota hai; Apply par revalidation hoti hai. Valid proposals hi add hote hain aur persistence ke liye Save/Update chahiye.

21. **AI proposals ke liye stale-state safeguards hain.** Hall change par pending proposal expire hota hai aur stale response ignore hota hai. Apply par fitting count badla ho toh updated result dobara review ke liye aata hai. Clear/remove proposal bhi explicit Apply maangta hai; proposal ke baad stalls state badli ho toh removal expire hota hai. Removal normal cancellation/removal workflow use karta hai. AI recommendation placement rules bypass nahi karti; actual generation backend availability par depend karti hai.

22. **Stall lifecycle aur numbering alag concerns hain.** AVAILABLE, BOOKED aur CANCELLED supported statuses hain. New stall ko save se pehle permanent number nahi milta. Numbered stall remove karne par CANCELLED hota hai aur number retain karta hai; unnumbered local stall list se remove hota hai. Cancellation persist karne ke liye Save/Update chahiye. Contract ke mutabik later stalls ko cancellation ke baad renumber nahi karna chahiye. BOOKED ko generic edit-lock maana nahi ja sakta: explicit AVAILABLE-only guard split par hai.

23. **Split sirf AVAILABLE parent par hai.** 2–100 equal children local X ya Z direction mein ban sakte hain. Passage arrangement mein gaps parent ke existing footprint ke andar reserve hote hain. Example: 12 m span, two children, 4 m passage → har child ka span 4 m. Child dimensions configured grid par fit honi chahiye. Back-to-back split exactly two children ka hai aur normal touching/corner/opening rules pass karne chahiye.

24. **Split preview aur permanent result separate hain.** Parent identifier required hai; preview numbers `parent-A`, `parent-B`, … `parent-Z`, `parent-AA` format mein provisional hote hain. Parent ka `5-10` jaisa identifier size nahi maana jata. Confirm ke liye saved layout, persisted parent number/backend ID aur clean preview required hain. Current geometry/settings saved version se match na karein toh pehle Update karna hota hai. Server confirmation ke bina children local layout mein insert nahi hote.

25. **Split request mein consistency checks hain.** Same request retry idempotency key reuse karti hai. In-flight edits ko late server response overwrite nahi karta; reopen/check prompt aata hai. Backend endpoint unavailable ho toh parent retained rehta hai. Parent cancellation/split-parent flag aur child lineage server contract ka part hain; permanent child numbering server response se confirm hoti hai.

26. **Save/Update se pehle full active-layout audit hai.** Unresolved placement violations ya invalid passage setting par write block hoti hai. Existing invalid saved layout open reh sakta hai taaki repair ho sake. Update ko selected/open saved layout chahiye. Empty layout name hall name se fallback hota hai. Hall boundary, blocked areas, zones, openings, rules aur plan annotations ke saath stall dimensions, position, rotation aur openings payload mein jate hain. Backend rejection user ko show hota hai; saved layout ka separate server audit bhi available hai.

27. **Excel import basic layout import hai.** Hall/Halls, Stall/Stalls aur combined Layout/Layouts sheets recognize hoti hain; first hall row use hoti hai. Basic dimensions, position, color aur opening columns map hote hain. Basic hall boundary ke bahar stalls drop hote hain, lekin overlapping imported rows retain hoti hain. Isliye imported layout ko audit/repair karke save karna hai. Current Excel parser advanced zones, arbitrary rotation, booking state aur split lineage ka full round-trip importer nahi hai.

28. **SelfCare import source floor plan ko preserve karta hai.** Matching hall name update hota hai, missing hall local add hota hai. Source rectangles, walls/outside areas, recognized restriction zones, labels, amenities, compass aur legend map hote hain. Top-left metre coordinates centre-origin planner coordinates mein convert hote hain; label/icon coordinates ka conversion 20 px per metre use karta hai. Source mein absent restriction bands invent nahi kiye jate. Hidden restrictions active rehti hain. Generic coloured `zone`/pillar rectangles automatically physical blockers nahi; recognized rule-zone classification matter karti hai.

29. **Master hall save aur layout save different workflows hain.** Master hall plan directly save karne ke liye existing numeric server hall ID chahiye. Custom/imported local hall ko layout ke through persist kiya ja sakta hai. Saved layout deletion se pehle confirmation dialog hai. Backend unavailable/empty ho toh clearly labelled 40 × 40 m offline sample hall available hai; preset catalogue fail ho toh Custom draw available rehta hai. Offline editing permanent server save ki guarantee nahi; page state page lifecycle ke saath discard hoti hai.

30. **Dashboard totals ko correctly interpret karna hai.** Shop count cancelled records ko include karta hai; occupied area sirf active stalls ke width × length ka sum hai. Occupancy percentage nominal rectangular/circular hall area par based hai. Irregular usable floor, holes, restricted zones aur required passages deduct karke net saleable capacity calculate nahi hoti.

## Meeting mein clear rakhne wali limitations

- Implemented placement validation primarily 2D floor geometry hai. Height editable/rendered hai, lekin reviewed placement engine mein hall ceiling limit, structural load, electrical load, fire-material checks ya full evacuation-route/crowd-capacity simulation nahi mili.
- Rule references mein ITPO D-section labels present hain. Yeh report implemented code behaviour describe karti hai; current official guideline compliance/certification independently verify nahi ki gayi.
- Door/zone enforcement supplied metadata par depend karta hai. Missing opening geometry, unrecognized imported area classification ya sirf visual label ko complete safety data nahi maana ja sakta.
- Free-space count/occupancy percentage ko maximum simultaneously placeable stalls ya net saleable area ke roop mein quote nahi karna.
- AI, permanent numbering, save, server audit aur atomic split ka live result backend implementation/availability par depend karta hai. Is report mein backend ko fresh execute/inspect nahi kiya gaya.
- Is request mein application behaviour change nahi kiya gaya. Browser, TypeScript, production build aur performance tests rerun nahi hue; report static code review par based hai.

## Implementation references

- `src/app/planner/geometry/placement-rules.ts` — defaults, dimensions, boundaries, spacing, frontages, zones, openings, audit.
- `src/app/planner/geometry/oriented-placement.ts` and `polygon-geometry.ts` — rotated footprints, distance, access corridors.
- `src/app/planner/geometry/hall-rules.ts`, `hall-plan.ts`, `grid-system.ts`, `free-space.ts` — usable floor, common validation context, snapping, search.
- `src/app/planner/planner-store.service.ts` — add/edit/drag/duplicate/cancel, save/update, suggestions, split confirmation.
- `src/app/planner/geometry/stall-split.ts` — equal children, passages, suffixes, preview validation.
- `src/app/planner/ai-chat-session.service.ts` and `layout-assistant.service.ts` — active AI chat, review/apply/clear safeguards, backend request.
- `src/app/planner/excel/excel-layout.service.ts` and `geometry/selfcare-layout.ts` — import behaviour and scope.
- `src/app/planner/layout-api.service.ts` — persisted payload and backend endpoints.
- `src/app/planner/planner-page.component.ts` — occupancy and shop totals.
- `src/app/planner/components/edit-stall-form.component.*`, `editor-toolbar.component.*`, `violations-panel.component.*` — user controls and feedback.
- `docs/stall-placement-contract.md` — documented frontend/backend placement and numbering contract; not a fresh backend test result.
