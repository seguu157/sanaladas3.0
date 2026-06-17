import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, MapPin, ChevronDown } from 'lucide-react';
import { Order } from '../types';

interface CalendarProps {
  orders: Order[];
  onSelectOrder: (order: Order) => void;
}

const Calendar: React.FC<CalendarProps> = ({ orders, onSelectOrder }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  
  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Función para extraer la hora de preparación más temprana
  const getEarliestPreparationTime = (order: Order): string | null => {
    const mealTimes = order.data.order_information.meal_times;
    const times: string[] = [];

    if (mealTimes.breakfast?.preparation_time) times.push(mealTimes.breakfast.preparation_time);
    if (mealTimes.lunch?.preparation_time) times.push(mealTimes.lunch.preparation_time);
    if (mealTimes.dinner?.preparation_time) times.push(mealTimes.dinner.preparation_time);

    if (times.length === 0) return null;

    // Ordenar las horas y devolver la más temprana
    return times.sort()[0];
  };

  // Hora a mostrar para un pedido en el calendario. A diferencia de
  // getEarliestPreparationTime: recorre TODOS los tipos de comida (no solo
  // breakfast/lunch/dinner) y, si el pedido no tiene hora de preparación,
  // cae a la hora de entrega. Así el pedido SIEMPRE muestra una hora si tiene
  // cualquier horario definido (antes el último pedido sin preparación
  // quedaba sin hora).
  const getOrderDisplayTime = (order: Order): string | null => {
    const mealTimes = order.data?.order_information?.meal_times;
    if (!mealTimes) return null;

    const prep: string[] = [];
    const delivery: string[] = [];
    Object.values(mealTimes).forEach((meal: any) => {
      if (meal?.preparation_time) prep.push(meal.preparation_time);
      if (meal?.delivery_time) delivery.push(meal.delivery_time);
    });

    if (prep.length > 0) return prep.sort()[0];
    if (delivery.length > 0) return delivery.sort()[0];
    return null;
  };

  // Función para convertir hora a minutos para ordenar
  const timeToMinutes = (time: string): number => {
    const match = time.match(/(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  };

  // Agrupar pedidos por fecha y ordenar por hora
  const ordersByDate = useMemo(() => {
    const grouped: Record<string, Order[]> = {};

    if (Array.isArray(orders)) {
      orders.forEach(order => {
      // Parsear la fecha del evento (formato: "25 julio", "15 diciembre", etc.)
      const eventDate = order.data.order_information.event_date;
      const currentYear = new Date().getFullYear();

      // Convertir mes en español a número
      const monthMap: Record<string, number> = {
        'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
        'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11
      };

      const parts = eventDate.toLowerCase().split(' ');
      if (parts.length >= 2) {
        const day = parseInt(parts[0]);
        const monthName = parts[1];
        const monthIndex = monthMap[monthName];

        if (!isNaN(day) && monthIndex !== undefined) {
          const date = new Date(currentYear, monthIndex, day);
          const dateKey = date.toISOString().split('T')[0];

          if (!grouped[dateKey]) {
            grouped[dateKey] = [];
          }
          grouped[dateKey].push(order);
        }
      }
      });
    }

    // Ordenar pedidos por hora de preparación en cada fecha
    Object.keys(grouped).forEach(dateKey => {
      grouped[dateKey].sort((a, b) => {
        const timeA = getEarliestPreparationTime(a);
        const timeB = getEarliestPreparationTime(b);

        if (!timeA && !timeB) return 0;
        if (!timeA) return 1;
        if (!timeB) return -1;

        return timeToMinutes(timeA) - timeToMinutes(timeB);
      });
    });

    return grouped;
  }, [orders]);

  // Obtener días del mes actual
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    // getDay(): 0=Dom, 1=Lun, ... 6=Sáb. Con la semana arrancando en lunes,
    // el offset es (getDay() + 6) % 7 → Lun=0, Mar=1, ..., Sáb=5, Dom=6.
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7;

    const days = [];
    
    // Días del mes anterior para completar la primera semana
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const prevDate = new Date(year, month, -i);
      days.push({
        date: prevDate,
        isCurrentMonth: false,
        orders: []
      });
    }
    
    // Días del mes actual
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateKey = date.toISOString().split('T')[0];
      days.push({
        date,
        isCurrentMonth: true,
        orders: ordersByDate[dateKey] || []
      });
    }
    
    // Días del mes siguiente para completar la última semana
    const remainingDays = 42 - days.length; // 6 semanas * 7 días
    for (let day = 1; day <= remainingDays; day++) {
      const nextDate = new Date(year, month + 1, day);
      days.push({
        date: nextDate,
        isCurrentMonth: false,
        orders: []
      });
    }
    
    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const toggleDateExpansion = (dateKey: string) => {
    setExpandedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateKey)) {
        newSet.delete(dateKey);
      } else {
        newSet.add(dateKey);
      }
      return newSet;
    });
  };

  const days = getDaysInMonth();

  const getColorDot = (color: string) => {
    const colorMap: Record<string, string> = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      yellow: 'bg-yellow-500'
    };
    return colorMap[color] || 'bg-gray-500';
  };

  // Vista agenda (móvil): días del mes que tienen pedidos, más hoy si está
  // dentro del mes navegado, ordenados cronológicamente.
  const agendaDays = days
    .filter(d => d.isCurrentMonth && (d.orders.length > 0 || isToday(d.date)))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const shortDayName = (d: Date) =>
    ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()];

  return (
    <div className="w-full space-y-2 relative z-50">
      {/* Header con selector de mes integrado */}
      <div className="bg-white rounded-lg sm:rounded-xl shadow-lg p-3 sm:p-4 relative z-50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          {/* Título y contador */}
          <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
            <div className="min-w-0 flex-1 sm:flex-initial">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate">Calendario</h2>
              <p className="text-xs text-slate-600">
                {orders?.length ?? 0} pedido{(orders?.length ?? 0) !== 1 ? 's' : ''}
              </p>
            </div>

            <button
              onClick={goToToday}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap sm:hidden"
            >
              Hoy
            </button>
          </div>

          {/* Navegación del mes */}
          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => navigateMonth('prev')}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
              </button>

              <h3 className="text-sm sm:text-base font-semibold text-slate-800 min-w-[140px] sm:min-w-[160px] text-center">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
              </h3>

              <button
                onClick={() => navigateMonth('next')}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
              </button>
            </div>

            <button
              onClick={goToToday}
              className="hidden sm:block px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              Hoy
            </button>
          </div>
        </div>
      </div>

      {/* Vista Agenda (solo móvil) */}
      <div className="block sm:hidden bg-white rounded-lg shadow-lg p-3 relative z-50">
        {agendaDays.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">
            No hay pedidos en {monthNames[currentDate.getMonth()].toLowerCase()}.
          </p>
        ) : (
          <div className="space-y-3">
            {agendaDays.map((d) => {
              const isCurrentDay = isToday(d.date);
              const dateKey = d.date.toISOString().split('T')[0];
              const totalAttendees = d.orders.reduce((sum, order) => {
                const n = parseInt(order.data.order_information.number_of_attendees, 10);
                return sum + (isNaN(n) ? 0 : n);
              }, 0);
              return (
                <div
                  key={dateKey}
                  className={`rounded-lg border p-2.5 ${
                    isCurrentDay
                      ? 'border-amber-400 bg-amber-50/60'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-full text-sm font-bold flex-shrink-0 ${
                          isCurrentDay
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {d.date.getDate()}
                      </span>
                      <span className="text-xs text-slate-600 font-semibold uppercase tracking-wide">
                        {shortDayName(d.date)}
                      </span>
                      {isCurrentDay && (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
                          Hoy
                        </span>
                      )}
                    </div>
                    {totalAttendees > 0 && (
                      <div
                        className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full flex-shrink-0"
                        title={`${totalAttendees} comensales en total`}
                      >
                        <Users className="h-3 w-3" />
                        <span>{totalAttendees}</span>
                      </div>
                    )}
                  </div>
                  {d.orders.length === 0 ? (
                    <p className="text-xs text-slate-500 italic px-1">Sin pedidos.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {d.orders.map((order, idx) => {
                        const preparationTime = getOrderDisplayTime(order);
                        const orderColors = order.orderColors || [];
                        return (
                          <button
                            key={idx}
                            onClick={() => onSelectOrder(order)}
                            className="w-full text-left p-2 rounded-md bg-white hover:bg-slate-100 active:bg-slate-200 border border-slate-200 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              {orderColors.length > 0 && (
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  {orderColors.map((c, ci) => (
                                    <div
                                      key={ci}
                                      className={`w-2 h-2 rounded-full ${getColorDot(c)}`}
                                      title={c}
                                    />
                                  ))}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm text-slate-800 truncate">
                                  {order.data.client_details.company_name}
                                </p>
                                {preparationTime && (
                                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>{preparationTime}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid del calendario (oculto en móvil) */}
      <div className="hidden sm:block bg-white rounded-lg sm:rounded-xl shadow-lg p-2 sm:p-4 relative z-50">

        {/* Días de la semana */}
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1 sm:mb-2">
          {dayNames.map(day => (
            <div key={day} className="p-1 sm:p-2 text-center text-[10px] sm:text-sm font-semibold text-slate-600">
              {day}
            </div>
          ))}
        </div>

        {/* Grid del calendario */}
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {days.map((day, index) => {
            const hasOrders = day.orders.length > 0;
            const isCurrentDay = isToday(day.date);
            const dateKey = day.date.toISOString().split('T')[0];
            const isExpanded = expandedDates.has(dateKey);
            const hasMultipleOrders = day.orders.length > 1;
            // Total de comensales del día sumando todos los pedidos
            const totalAttendees = day.orders.reduce((sum, order) => {
              const n = parseInt(order.data.order_information.number_of_attendees, 10);
              return sum + (isNaN(n) ? 0 : n);
            }, 0);

            return (
              <div
                key={index}
                className={`aspect-square sm:aspect-auto ${
                  isExpanded
                    ? 'sm:min-h-[200px] md:min-h-[250px] lg:min-h-[300px]'
                    : 'sm:min-h-[70px] md:min-h-[90px] lg:min-h-[110px]'
                } p-0.5 sm:p-1.5 border rounded transition-all ${
                  day.isCurrentMonth
                    ? hasOrders
                      ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                      : 'border-slate-200 hover:bg-slate-50'
                    : 'border-slate-100 bg-slate-50/50 text-slate-400'
                } ${
                  isCurrentDay && day.isCurrentMonth
                    ? 'ring-2 ring-amber-500 ring-offset-1'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-0.5 sm:mb-1">
                  <div className={
                    isCurrentDay && day.isCurrentMonth
                      ? 'inline-flex items-center justify-center min-w-[1.25rem] sm:min-w-[1.5rem] h-5 sm:h-6 px-1 sm:px-1.5 rounded-full bg-amber-500 text-white text-[10px] sm:text-xs font-bold shadow-sm'
                      : `text-xs sm:text-sm font-semibold ${
                          day.isCurrentMonth ? 'text-slate-800' : 'text-slate-400'
                        }`
                  }>
                    {day.date.getDate()}
                  </div>
                  {hasOrders && totalAttendees > 0 && (
                    <div
                      className="flex items-center gap-0.5 text-[9px] sm:text-[10px] font-semibold text-blue-700 bg-blue-100 px-1 sm:px-1.5 py-0.5 rounded"
                      title={`${totalAttendees} comensales en total`}
                    >
                      <Users className="h-2.5 w-2.5 flex-shrink-0" />
                      <span>{totalAttendees}</span>
                    </div>
                  )}
                </div>

                {hasOrders && (
                  <div className={`space-y-0.5 sm:space-y-1 ${isExpanded ? '' : 'overflow-hidden'}`}>
                    {(isExpanded ? day.orders : day.orders.slice(0, 1)).map((order, orderIndex) => {
                      const preparationTime = getOrderDisplayTime(order);
                      const orderColors = order.orderColors || [];

                      return (
                        <div
                          key={orderIndex}
                          onClick={() => onSelectOrder(order)}
                          className="p-1 sm:p-1.5 rounded text-[10px] sm:text-xs cursor-pointer transition-all bg-slate-100 hover:bg-slate-200 border border-slate-300"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="font-semibold truncate leading-tight text-slate-800 flex-1 min-w-0">
                              {order.data.client_details.company_name}
                            </div>
                            {orderColors.length > 0 && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {orderColors.map((color, idx) => (
                                  <div
                                    key={idx}
                                    className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${getColorDot(color)}`}
                                    title={color}
                                  ></div>
                                ))}
                              </div>
                            )}
                          </div>
                          {preparationTime && (
                            <div className="flex items-center gap-1 mt-0.5 text-[9px] sm:text-[10px] text-slate-600">
                              <Clock className="h-2.5 w-2.5 flex-shrink-0" />
                              <span className="font-medium">{preparationTime}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {hasMultipleOrders && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDateExpansion(dateKey);
                        }}
                        className="w-full text-[9px] sm:text-xs text-blue-600 hover:text-blue-800 text-center py-0.5 sm:py-1 font-medium bg-blue-50 hover:bg-blue-100 rounded transition-colors flex items-center justify-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <span>Ocultar</span>
                            <ChevronDown className="h-3 w-3 rotate-180 transition-transform" />
                          </>
                        ) : (
                          <>
                            <span>+{day.orders.length - 1} mas</span>
                            <ChevronDown className="h-3 w-3 transition-transform" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Leyenda compacta */}
      <div className="bg-white rounded-lg sm:rounded-xl shadow-sm p-2 sm:p-3 relative z-50">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] sm:text-xs">
          <span className="font-semibold text-slate-700 text-xs">Colores:</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-blue-500 rounded-full"></div>
            <span className="text-slate-600">Azul</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-green-500 rounded-full"></div>
            <span className="text-slate-600">Verde</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-red-500 rounded-full"></div>
            <span className="text-slate-600">Rojo</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-yellow-500 rounded-full"></div>
            <span className="text-slate-600">Amarillo</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Calendar;