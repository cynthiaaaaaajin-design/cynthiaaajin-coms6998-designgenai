import type { TravelTheme } from '@/lib/destinations';

// Original geometric scenes share a print-inspired palette and a 640 × 360 canvas.
export function CoverScene({ theme }: { theme: TravelTheme }) {
  switch (theme) {
    case 'beach': return <>
      <path fill="#a3c8c2" d="M0 160H640V360H0z" />
      <path fill="#e9d7b9" d="M0 290Q170 180 340 250T640 260V360H0Z" />
      <path d="M10 234Q170 168 350 218T640 219M70 250Q210 204 360 239" fill="none" stroke="#eff2df" strokeWidth="3" />
      <path d="M487 254V162M441 168Q485 97 531 168Z" fill="#c88870" stroke="#795b48" strokeWidth="3" />
      <path d="M530 282h55" stroke="#8c9a7d" strokeWidth="5" />
    </>;
    case 'island': return <>
      <path fill="#98beb8" d="M0 190H640V360H0z" />
      <path fill="#6d9783" d="M95 235Q180 206 244 128Q295 95 356 185Q427 179 522 235Z" />
      <path fill="#eadab9" d="M69 251Q305 206 549 251Q309 281 69 251Z" />
      <path d="M218 179l31-44 28 38M70 291h110m204 16h145M110 321h240" fill="none" stroke="#e0e9d7" strokeWidth="3" />
      <path fill="#fbf4df" d="M535 133v58h-40z" /><path d="M535 127v72h-46" fill="none" stroke="#547b73" strokeWidth="3" />
    </>;
    case 'europe-city': return <>
      <path fill="#b9c6ae" d="M0 230Q290 104 640 230V360H0Z" />
      {[{x:80,y:165,h:135,c:'#cf957c'},{x:180,y:132,h:168,c:'#e5c69e'},{x:280,y:177,h:123,c:'#b8bba2'},{x:380,y:143,h:157,c:'#d8a98c'}].map(({x,y,h,c})=><g key={x}>
        <path fill={c} d={`M${x} ${y}h86v${h}h-86z`} /><path fill="#916f60" d={`M${x-7} ${y}l50-30 50 30z`} />
        {[0,1].map(row=>[0,1,2].map(col=><rect key={`${row}${col}`} x={x+13+col*24} y={y+22+row*37} width="11" height="19" rx="5" fill="#f8efd9" />))}
      </g>)}
      <path fill="#d5c7ae" d="M0 300H640V360H0z" /><path d="M260 360l55-61m77 61-28-61" stroke="#eee6d5" strokeWidth="3" />
      <path d="M528 287v-77m-24 21q24-58 48 0q-24 38-48 0" stroke="#507b69" strokeWidth="8" fill="#7f9e7c" />
    </>;
    case 'asia-city': return <>
      <path fill="#b9c7b5" d="M0 225L163 110l157 131 127-92 193 94V360H0Z" />
      <path fill="#d1b99c" d="M185 198h199v110H185z" />
      <path fill="#496f65" d="M146 205q91-20 139-69 51 50 139 69zm32 53q68-19 107-52 45 39 114 52z" />
      <path d="M234 273v35m52-35v35m51-35v35" stroke="#805e50" strokeWidth="12" />
      <path fill="#8aa58d" d="M0 308q190-42 345 9t295-13v56H0Z" />
      <path d="M516 302q-12-113 34-165m-28 82-48-24" stroke="#867465" strokeWidth="7" fill="none" />
      {[{x:536,y:150},{x:492,y:172},{x:555,y:181},{x:468,y:194}].map(p=><circle key={p.x} cx={p.x} cy={p.y} r="27" fill="#d9aaa1" />)}
    </>;
    case 'mountain': return <>
      <path fill="#afc3bc" d="M0 286L180 74l169 213L471 101l169 194v65H0Z" />
      <path fill="#6f948a" d="M68 360L308 109 556 360Z" />
      <path fill="#f5eedf" d="M244 177l64-68 65 68-43-14-24 22-26-28zM136 126l44-52 44 56-45-21z" />
      <path fill="#355f53" d="M0 326q220-41 350 8t290-26v52H0Z" />
    </>;
    case 'tropical': return <>
      <path fill="#a4c5b4" d="M0 222Q192 104 351 201T640 178V360H0Z" />
      <path fill="#6b9780" d="M0 269Q187 175 373 248T640 211V360H0Z" />
      <path d="M0 292Q220 208 405 281T640 258M0 321Q230 237 406 311T640 287" fill="none" stroke="#c7d2a5" strokeWidth="7" />
      <path d="M481 327Q494 204 467 129" stroke="#6b7460" strokeWidth="10" fill="none" />
      <path d="M467 139q-74-80-137 5 76-36 137-5M467 139q70-93 136-24-71-19-136 24M467 139q-73-12-89 60 43-41 89-60M467 139q76-22 101 50-49-41-101-50" fill="#3d7160" />
    </>;
    default: return <>
      <path fill="#b7c6a8" d="M0 218Q146 98 323 214T640 180V360H0Z" />
      <path fill="#749e8c" d="M0 283Q175 163 360 282T640 240V360H0Z" />
      <path fill="#3d7366" d="M0 338Q230 228 640 306V360H0Z" />
      <path d="M254 356Q448 274 357 244t-58-57" fill="none" stroke="#f0dfb9" strokeWidth="5" strokeDasharray="3 10" strokeLinecap="round" />
      <circle cx="299" cy="182" r="7" fill="#f0dfb9" />
    </>;
  }
}
