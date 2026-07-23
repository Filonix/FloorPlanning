/* ============ Furniture library ============
 * Each item: { id, name, cat, w, h (cm), draw(ctx, w, h) }
 * draw() receives pixel width/height already scaled; origin at item center.
 * Local coords: centered on (0,0). Use negative half-dims.
 */
window.FURNITURE = (function () {
  const items = [
    // ===== Living / bedroom =====
    {
      id: 'sofa3', name: 'Диван 3-мест', cat: 'Гостиная', w: 220, h: 90,
      icon: '<rect x="2" y="14" width="36" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2" y="10" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16" y="10" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="30" y="10" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c, w, h) {
        const hw=w/2, hh=h/2;
        c.strokeRect(-hw,-hh+14,w,h-14);
        c.strokeRect(-hw,-hh,8,h); c.strokeRect(-hw+8,-hh,w-16,14);
        c.strokeRect(hw-8,-hh,8,h);
      }
    },
    {
      id: 'sofa2', name: 'Диван 2-мест', cat: 'Гостиная', w: 160, h: 90,
      icon: '<rect x="4" y="14" width="32" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="10" width="10" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="26" y="10" width="10" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh+12,w,h-12);c.strokeRect(-hw,-hh,8,h);c.strokeRect(-hw+8,-hh,w-16,12);c.strokeRect(hw-8,-hh,8,h);}
    },
    {
      id: 'armchair', name: 'Кресло', cat: 'Гостиная', w: 90, h: 90,
      icon: '<rect x="8" y="16" width="24" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="12" width="6" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="26" y="12" width="6" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw+4,-hh+10,w-8,h-10);c.strokeRect(-hw+4,-hh,8,h);c.strokeRect(hw-12,-hh,8,h);}
    },
    {
      id: 'bed_double', name: 'Кровать 2-сп', cat: 'Спальня', w: 180, h: 200,
      icon: '<rect x="6" y="6" width="28" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="9" width="22" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 22h28" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+6,-hh+6,w-12,h*0.35);c.beginPath();c.moveTo(-hw,hh-h*0.35);c.lineTo(hw,hh-h*0.35);c.stroke();}
    },
    {
      id: 'bed_single', name: 'Кровать 1-сп', cat: 'Спальня', w: 100, h: 200,
      icon: '<rect x="12" y="6" width="14" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="9" width="10" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+5,-hh+5,w-10,h*0.35);c.beginPath();c.moveTo(-hw,hh-h*0.35);c.lineTo(hw,hh-h*0.35);c.stroke();}
    },
    {
      id: 'wardrobe', name: 'Шкаф', cat: 'Спальня', w: 180, h: 60,
      icon: '<rect x="4" y="10" width="30" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 10v20M24 10v20M19 16l1 2-1 2M19 18h0" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const n=Math.max(2,Math.round(w/60));for(let i=1;i<n;i++){c.beginPath();c.moveTo(-hw+i*w/n,-hh);c.lineTo(-hw+i*w/n,hh);c.stroke();}for(let i=0;i<n;i++){c.beginPath();c.arc(-hw+(i+0.5)*w/n,0,2,0,Math.PI*2);c.stroke();}}
    },
    {
      id: 'nightstand', name: 'Тумба', cat: 'Спальня', w: 50, h: 45,
      icon: '<rect x="10" y="12" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="20" r="1.2" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.arc(0,0,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'desk', name: 'Письм. стол', cat: 'Спальня', w: 120, h: 60,
      icon: '<rect x="4" y="12" width="30" height="16" fill="none" stroke="currentColor" stroke-width="2"/><rect x="6" y="20" width="10" height="8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+4,-hh+h*0.4,w*0.35,h*0.5);}
    },
    {
      id: 'tv_stand', name: 'ТВ-тумба', cat: 'Гостиная', w: 160, h: 45,
      icon: '<rect x="4" y="14" width="30" height="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14v12M24 14v12" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.moveTo(-hw+w/3,-hh);c.lineTo(-hw+w/3,hh);c.moveTo(-hw+2*w/3,-hh);c.lineTo(-hw+2*w/3,hh);c.stroke();}
    },
    {
      id: 'coffee_table', name: 'Журн. стол', cat: 'Гостиная', w: 110, h: 60,
      icon: '<rect x="6" y="14" width="26" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);}
    },
    {
      id: 'dining_table', name: 'Обед. стол', cat: 'Кухня', w: 140, h: 80,
      icon: '<rect x="6" y="12" width="26" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="28" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="32" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="32" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="28" cy="32" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const chairs=[[0,-1],[0,1],[-1,0],[1,0]];const cs=Math.min(w,h)*0.22;chairs.forEach(([dx,dy])=>{c.strokeRect(dx*hw*0.7-cs/2,dy*hh*0.95-cs/2,cs,cs);});}
    },
    {
      id: 'chair', name: 'Стул', cat: 'Кухня', w: 45, h: 45,
      icon: '<rect x="12" y="12" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 12V8h8v4" stroke="currentColor" stroke-width="1.5" fill="none"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw+3,-hh+3,w-6,h-6);c.strokeRect(-hw+5,-hh,w-10,5);}
    },

    // ===== Kitchen =====
    {
      id: 'kitchen_l', name: 'Кухня углов.', cat: 'Кухня', w: 200, h: 60,
      icon: '<path d="M4 14h22V26H4zM26 14h8v20h-8z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="20" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="20" cy="20" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="29" y="22" width="4" height="4" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(hw-h,-hh,h,h+h);c.strokeRect(hw-h+4,-hh+4,h-8,8);c.beginPath();c.arc(-hw+w*0.3,0,3,0,Math.PI*2);c.stroke();c.beginPath();c.arc(hw-h*0.5,hh*0.3,4,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'fridge', name: 'Холодильник', cat: 'Кухня', w: 70, h: 70,
      icon: '<rect x="10" y="6" width="20" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 16h20" stroke="currentColor" stroke-width="1.5"/><path d="M13 10v3M13 19v3" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.moveTo(-hw,0);c.lineTo(hw,0);c.stroke();c.beginPath();c.moveTo(-hw+4,-hh*0.3);c.lineTo(-hw+4,-hh*0.6);c.moveTo(-hw+4,hh*0.3);c.lineTo(-hw+4,hh*0.6);c.stroke();}
    },
    {
      id: 'stove', name: 'Плита', cat: 'Кухня', w: 60, h: 60,
      icon: '<rect x="8" y="8" width="24" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="15" cy="15" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="25" cy="15" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="15" cy="25" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="25" cy="25" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const r=Math.min(w,h)*0.12;[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{c.beginPath();c.arc(dx*w*0.22,dy*h*0.22,r,0,Math.PI*2);c.stroke();});}
    },
    {
      id: 'sink', name: 'Мойка', cat: 'Кухня', w: 80, h: 55,
      icon: '<rect x="6" y="12" width="26" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="15" width="9" height="10" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="20" y="15" width="9" height="10" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="19" cy="9" r="1.5" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+4,-hh+4,w*0.42,h-8);c.strokeRect(hw*0.08,-hh+4,w*0.42,h-8);c.beginPath();c.arc(0,-hh+2,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'dishwasher', name: 'Посудомойка', cat: 'Кухня', w: 60, h: 60,
      icon: '<rect x="10" y="8" width="20" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 14h20" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="11" r="1" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.moveTo(-hw,-hh*0.3);c.lineTo(hw,-hh*0.3);c.stroke();c.beginPath();c.arc(0,-hh*0.65,2,0,Math.PI*2);c.fill();}
    },

    // ===== Bathroom =====
    {
      id: 'toilet', name: 'Унитаз', cat: 'Санузел', w: 40, h: 65,
      icon: '<rect x="12" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 16c-2 4-2 12 6 12s8-8 6-12" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw+2,-hh,w-4,h*0.25);c.beginPath();c.ellipse(0,hh*0.2,w*0.42,h*0.4,0,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'bathtub', name: 'Ванна', cat: 'Санузел', w: 170, h: 75,
      icon: '<rect x="4" y="12" width="30" height="16" rx="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="30" cy="20" r="1.5" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.roundRect?c.roundRect(-hw,-hh,w,h,8):c.rect(-hw,-hh,w,h);c.stroke();c.beginPath();c.ellipse(0,0,w*0.4,h*0.3,0,0,Math.PI*2);c.stroke();c.beginPath();c.arc(hw-6,0,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'shower', name: 'Душ. кабина', cat: 'Санузел', w: 90, h: 90,
      icon: '<rect x="8" y="8" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8l24 24M32 8L8 32" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/><circle cx="20" cy="6" r="1.5" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.moveTo(-hw,-hh);c.lineTo(hw,hh);c.moveTo(hw,-hh);c.lineTo(-hw,hh);c.stroke();c.beginPath();c.arc(0,-hh-2,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'sink_bath', name: 'Раковина', cat: 'Санузел', w: 60, h: 45,
      icon: '<rect x="6" y="14" width="26" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="19" cy="21" rx="9" ry="4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.ellipse(0,0,w*0.32,h*0.3,0,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'washing_machine', name: 'Стир. машина', cat: 'Санузел', w: 60, h: 60,
      icon: '<rect x="8" y="6" width="24" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="10" r="1" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.arc(0,hh*0.1,Math.min(w,h)*0.3,0,Math.PI*2);c.stroke();c.beginPath();c.arc(-hw+6,-hh+6,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'boiler', name: 'Бойлер', cat: 'Санузел', w: 50, h: 80,
      icon: '<rect x="13" y="6" width="14" height="24" rx="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.roundRect?c.roundRect(-hw,-hh,w,h,w/2):c.rect(-hw,-hh,w,h);c.stroke();c.beginPath();c.arc(0,-hh*0.2,Math.min(w,h)*0.15,0,Math.PI*2);c.stroke();}
    },

    // ===== Misc / appliances =====
    {
      id: 'plant', name: 'Растение', cat: 'Декор', w: 50, h: 50,
      icon: '<circle cx="20" cy="18" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 26h12l-2 6h-8z" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2,r=Math.min(w,h)*0.35;c.beginPath();c.arc(0,-hh*0.2,r,0,Math.PI*2);c.stroke();c.strokeRect(-hw*0.4,hh*0.2,w*0.8,h*0.4);}
    },
    {
      id: 'lamp', name: 'Лампа', cat: 'Декор', w: 40, h: 40,
      icon: '<circle cx="20" cy="20" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2,r=Math.min(w,h)*0.18;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke();c.beginPath();c.arc(0,0,r*2.2,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'stairs', name: 'Лестница', cat: 'Разное', w: 100, h: 240,
      icon: '<rect x="10" y="4" width="20" height="32" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 10h20M10 16h20M10 22h20M10 28h20" stroke="currentColor" stroke-width="1.2"/><path d="M10 4l10 6" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const n=8;for(let i=1;i<n;i++){c.beginPath();c.moveTo(-hw,-hh+i*h/n);c.lineTo(hw,-hh+i*h/n);c.stroke();}c.beginPath();c.moveTo(-hw,-hh);c.lineTo(0,-hh+h*0.25);c.lineTo(hw,-hh);c.stroke();}
    },
    {
      id: 'radiator', name: 'Батарея', cat: 'Разное', w: 80, h: 15,
      icon: '<rect x="4" y="16" width="32" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 16v8M16 16v8M22 16v8M28 16v8" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const n=Math.floor(w/8);for(let i=1;i<n;i++){c.beginPath();c.moveTo(-hw+i*w/n,-hh);c.lineTo(-hw+i*w/n,hh);c.stroke();}}
    },
    {
      id: 'car', name: 'Машиноместо', cat: 'Разное', w: 250, h: 500,
      icon: '<rect x="8" y="4" width="24" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><rect x="12" y="12" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.setLineDash([6,4]);c.strokeRect(-hw,-hh,w,h);c.setLineDash([]);c.strokeRect(-hw+w*0.18,-hh+h*0.22,w*0.64,h*0.56);}
    },
    // ===== Additional furniture =====
    {
      id: 'wardrobe_sliding', name: 'Шкаф-купе', cat: 'Спальня', w: 240, h: 70,
      icon: '<rect x="3" y="10" width="34" height="20" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 10v20M24 10v20" stroke="currentColor" stroke-width="1.5"/><path d="M19 14l2 4-2 4" stroke="currentColor" stroke-width="1.2" fill="none"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const n=Math.max(2,Math.round(w/80));for(let i=1;i<n;i++){c.beginPath();c.moveTo(-hw+i*w/n,-hh);c.lineTo(-hw+i*w/n,hh);c.stroke();}for(let i=0;i<n;i++){c.beginPath();c.moveTo(-hw+(i+0.5)*w/n-3,-hh*0.3);c.lineTo(-hw+(i+0.5)*w/n+3,-hh*0.3);c.stroke();}}
    },
    {
      id: 'bookshelf', name: 'Книжный шкаф', cat: 'Спальня', w: 90, h: 35,
      icon: '<rect x="8" y="8" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 16h24M8 24h24" stroke="currentColor" stroke-width="1.2"/><path d="M11 10v4M14 10v4M17 10v4M20 10v4" stroke="currentColor" stroke-width="0.8"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);for(let i=1;i<3;i++){c.beginPath();c.moveTo(-hw,-hh+i*h/3);c.lineTo(hw,-hh+i*h/3);c.stroke();}}
    },
    {
      id: 'desk_office', name: 'Рабочий стол', cat: 'Кабинет', w: 140, h: 70,
      icon: '<rect x="3" y="12" width="34" height="16" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="16" width="10" height="12" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="32" cy="20" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+4,-hh+h*0.4,w*0.32,h*0.55);c.beginPath();c.arc(hw-8,0,Math.min(w,h)*0.1,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'office_chair', name: 'Офисное кресло', cat: 'Кабинет', w: 60, h: 60,
      icon: '<circle cx="20" cy="18" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 26h12l-1 6h-10z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M20 32v3M16 35h8" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.arc(0,-hh*0.2,Math.min(w,h)*0.32,0,Math.PI*2);c.stroke();c.strokeRect(-hw*0.5,hh*0.2,w*0.5,h*0.4);}
    },
    {
      id: 'tv_wall', name: 'ТВ на стене', cat: 'Гостиная', w: 120, h: 10,
      icon: '<rect x="4" y="18" width="32" height="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 24v4M22 24v4" stroke="currentColor" stroke-width="1.2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw*0.3,hh-2,w*0.6,4);}
    },
    {
      id: 'fireplace', name: 'Камин', cat: 'Гостиная', w: 120, h: 40,
      icon: '<rect x="6" y="10" width="28" height="22" fill="none" stroke="currentColor" stroke-width="2"/><rect x="12" y="16" width="16" height="12" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M16 22c0-2 2-3 2-5M20 22c0-2 2-3 2-5" stroke="currentColor" stroke-width="1" fill="none"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw*0.5,-hh*0.2,w*0.5,h*0.6);}
    },
    {
      id: 'bidet', name: 'Биде', cat: 'Санузел', w: 40, h: 60,
      icon: '<rect x="12" y="8" width="16" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 16c-2 4-2 14 6 14s8-10 6-14" fill="none" stroke="currentColor" stroke-width="2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw+2,-hh,w-4,h*0.25);c.beginPath();c.ellipse(0,hh*0.2,w*0.42,h*0.4,0,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'water_heater', name: 'Водонагреватель', cat: 'Санузел', w: 50, h: 90,
      icon: '<rect x="13" y="4" width="14" height="30" rx="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="14" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M16 30h8" stroke="currentColor" stroke-width="1.2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.roundRect?c.roundRect(-hw,-hh,w,h,w/2):c.rect(-hw,-hh,w,h);c.stroke();c.beginPath();c.arc(0,-hh*0.3,Math.min(w,h)*0.12,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(-hw*0.3,hh*0.85);c.lineTo(hw*0.3,hh*0.85);c.stroke();}
    },
    {
      id: 'washer_dryer', name: 'Сушильная машина', cat: 'Санузел', w: 60, h: 60,
      icon: '<rect x="8" y="6" width="24" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.arc(0,hh*0.1,Math.min(w,h)*0.32,0,Math.PI*2);c.stroke();c.beginPath();c.arc(0,hh*0.1,Math.min(w,h)*0.18,0,Math.PI*2);c.setLineDash([2,2]);c.stroke();c.setLineDash([]);}
    },
    {
      id: 'microwave', name: 'Микроволновка', cat: 'Кухня', w: 50, h: 40,
      icon: '<rect x="4" y="12" width="32" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="7" y="15" width="20" height="12" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="31" cy="21" r="1.5" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+3,-hh+3,w*0.7,h-6);c.beginPath();c.arc(hw-4,0,2,0,Math.PI*2);c.fill();}
    },
    {
      id: 'oven', name: 'Духовка', cat: 'Кухня', w: 60, h: 60,
      icon: '<rect x="8" y="6" width="24" height="28" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="11" y="10" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 28h18" stroke="currentColor" stroke-width="1.2"/><circle cx="14" cy="30" r="1" fill="currentColor"/><circle cx="26" cy="30" r="1" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+4,-hh+4,w-8,h*0.55);c.beginPath();c.moveTo(-hw+4,hh-4);c.lineTo(hw-4,hh-4);c.stroke();}
    },
    {
      id: 'range_hood', name: 'Вытяжка', cat: 'Кухня', w: 70, h: 40,
      icon: '<path d="M6 10h28l-4 8H10z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 18v6M20 18v6M26 18v6" stroke="currentColor" stroke-width="1.2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.moveTo(-hw,-hh);c.lineTo(hw,-hh);c.lineTo(hw-4,-hh+h*0.5);c.lineTo(-hw+4,-hh+h*0.5);c.closePath();c.stroke();}
    },
    {
      id: 'kitchen_island', name: 'Кухонный остров', cat: 'Кухня', w: 180, h: 90,
      icon: '<rect x="4" y="12" width="32" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="20" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="28" cy="20" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.arc(-hw+w*0.3,0,3,0,Math.PI*2);c.arc(hw-w*0.3,0,3,0,Math.PI*2);c.stroke();}
    },
    {
      id: 'bar_stool', name: 'Барный стул', cat: 'Кухня', w: 40, h: 40,
      icon: '<circle cx="20" cy="20" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 28v4M16 32h8" stroke="currentColor" stroke-width="1.5"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.beginPath();c.arc(0,0,Math.min(w,h)*0.35,0,Math.PI*2);c.stroke();c.strokeRect(-hw*0.3,hh*0.5,w*0.6,h*0.3);}
    },
    {
      id: 'pool_table', name: 'Бильярд', cat: 'Разное', w: 220, h: 110,
      icon: '<rect x="4" y="10" width="32" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="20" r="2" fill="currentColor"/><circle cx="20" cy="20" r="2" fill="currentColor"/><circle cx="28" cy="20" r="2" fill="currentColor"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.strokeRect(-hw+4,-hh+4,w-8,h-8);[[-1,0],[0,0],[1,0]].forEach(p=>{c.beginPath();c.arc(p[0]*w*0.25,0,3,0,Math.PI*2);c.fill();});}
    },
    {
      id: 'piano', name: 'Пианино', cat: 'Разное', w: 150, h: 60,
      icon: '<rect x="3" y="14" width="34" height="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 14v12M12 14v12M16 14v12M20 14v12M24 14v12M28 14v12M32 14v12" stroke="currentColor" stroke-width="0.8"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);const n=14;for(let i=1;i<n;i++){c.beginPath();c.moveTo(-hw+i*w/n,-hh);c.lineTo(-hw+i*w/n,hh*0.4);c.stroke();}}
    },
    {
      id: 'safe', name: 'Сейф', cat: 'Разное', w: 50, h: 50,
      icon: '<rect x="8" y="8" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="20" r="5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M20 15v-2M20 27v-2M15 20h-2M27 20h-2" stroke="currentColor" stroke-width="1"/>',
      draw(c,w,h){const hw=w/2,hh=h/2;c.strokeRect(-hw,-hh,w,h);c.beginPath();c.arc(0,0,Math.min(w,h)*0.25,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(0,-hh*0.4);c.lineTo(0,-hh*0.55);c.moveTo(0,hh*0.4);c.lineTo(0,hh*0.55);c.moveTo(-hh*0.4,0);c.lineTo(-hh*0.55,0);c.moveTo(hh*0.4,0);c.lineTo(hh*0.55,0);c.stroke();}
    },
  ];

  const categories = [...new Set(items.map(i => i.cat))];

  return { items, categories };
})();
