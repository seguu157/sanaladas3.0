import React from 'react';
import { X, Mail, Copy, Check, ExternalLink } from 'lucide-react';
import { ExtractedData } from '../types';

interface EmailDraftModalProps {
  open: boolean;
  onClose: () => void;
  data: ExtractedData;
  orderName?: string | null;
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Desayuno',
  coffee_break: 'Coffee Break',
  finger_food: 'Finger Food',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

const buildSubject = (data: ExtractedData, orderName?: string | null) => {
  const ref = orderName || data.client_details.company_name || 'pedido';
  const date = data.order_information.event_date
    ? ` (${data.order_information.event_date})`
    : '';
  return `Confirmación de pedido — ${ref}${date}`;
};

const buildBody = (data: ExtractedData, orderName?: string | null) => {
  const { client_details, order_information } = data;
  const lines: string[] = [];

  const saludo = client_details.contact_person?.trim()
    ? `Hola ${client_details.contact_person.trim()},`
    : 'Hola,';
  lines.push(saludo);
  lines.push('');
  lines.push(
    'Antes de empezar con la preparación queremos confirmar los detalles del pedido. ¿Podrías revisar la siguiente información y confirmarnos que es correcta?'
  );
  lines.push('');

  if (orderName) {
    lines.push(`Referencia: ${orderName}`);
    lines.push('');
  }

  lines.push('— DATOS DEL CLIENTE —');
  if (client_details.company_name) lines.push(`Empresa: ${client_details.company_name}`);
  if (client_details.contact_person) lines.push(`Persona de contacto: ${client_details.contact_person}`);
  if (client_details.address) lines.push(`Dirección: ${client_details.address}`);
  if (client_details.phone_number) lines.push(`Teléfono: ${client_details.phone_number}`);
  if (client_details.email_address) lines.push(`Email: ${client_details.email_address}`);
  lines.push('');

  lines.push('— DATOS DEL PEDIDO —');
  if (order_information.event_date) lines.push(`Fecha del evento: ${order_information.event_date}`);
  if (order_information.number_of_attendees) lines.push(`Número de asistentes: ${order_information.number_of_attendees}`);
  if (order_information.sales_representative) lines.push(`Representante de ventas: ${order_information.sales_representative}`);

  // Horarios activos (solo si hay alguno con datos).
  const activeMeals = Object.entries(order_information.meal_times || {}).filter(
    ([, meal]) => meal && (meal.preparation_time || meal.delivery_time || meal.delivery_responsible)
  );
  if (activeMeals.length > 0) {
    lines.push('');
    lines.push('Horarios:');
    activeMeals.forEach(([type, meal]) => {
      const label = MEAL_LABELS[type] || type;
      const parts: string[] = [];
      if (meal!.preparation_time) parts.push(`preparación ${meal!.preparation_time}`);
      if (meal!.delivery_time) parts.push(`entrega ${meal!.delivery_time}`);
      if (meal!.delivery_responsible) parts.push(`responsable: ${meal!.delivery_responsible}`);
      lines.push(`  • ${label} — ${parts.join(', ') || 'sin especificar'}`);
    });
  }

  lines.push('');
  lines.push('Quedamos atentos a tu confirmación para arrancar con la preparación.');
  lines.push('');
  lines.push('Gracias,');

  return lines.join('\n');
};

const EmailDraftModal: React.FC<EmailDraftModalProps> = ({ open, onClose, data, orderName }) => {
  const [to, setTo] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  // Cuando se abre, rellenamos los campos con los datos del pedido.
  React.useEffect(() => {
    if (!open) return;
    setTo(data.client_details.email_address || '');
    setSubject(buildSubject(data, orderName));
    setBody(buildBody(data, orderName));
    setCopied(false);
  }, [open, data, orderName]);

  if (!open) return null;

  const openInMailClient = () => {
    const params = new URLSearchParams();
    if (subject) params.set('subject', subject);
    if (body) params.set('body', body);
    const query = params.toString().replace(/\+/g, '%20');
    const href = `mailto:${encodeURIComponent(to)}${query ? `?${query}` : ''}`;
    window.location.href = href;
  };

  const copyBody = async () => {
    try {
      const fullText = `Para: ${to}\nAsunto: ${subject}\n\n${body}`;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard error:', err);
      alert('No se pudo copiar al portapapeles. Selecciona el texto manualmente.');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={onClose}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[9999] w-[calc(100vw-2rem)] max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Mail className="h-4 w-4 text-blue-600" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-800">
              Crear nuevo mail
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
            title="Cerrar"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Para</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="cliente@empresa.com"
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Asunto</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Cuerpo del mail</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono leading-relaxed"
            />
          </label>

          <p className="text-xs text-slate-500">
            Al pulsar <strong>Abrir en mi cliente de correo</strong> se abrirá tu programa de
            correo predeterminado (Outlook, Gmail, etc.) con el mail ya redactado. Podrás
            revisarlo y enviarlo desde allí.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button
            onClick={copyBody}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Copiado' : 'Copiar al portapapeles'}</span>
          </button>
          <button
            onClick={openInMailClient}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Abrir en mi cliente de correo</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default EmailDraftModal;
