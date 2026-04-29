import React, { useState } from 'react';
import { MessageSquare, Plus, Clock, Trash2, Pencil } from 'lucide-react';
import { Comment } from '../types';
import RichCommentEditor from './RichCommentEditor';
import SafeHtml from './SafeHtml';

interface CommentsProps {
  orderId: string;
  comments: Comment[];
  onAddComment: (orderId: string, text: string) => void;
  onUpdateComment: (orderId: string, commentId: string, text: string) => void;
  onDeleteComment: (orderId: string, commentId: string) => void;
}

const Comments: React.FC<CommentsProps> = ({
  orderId,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const formatTimestamp = (timestamp: Date) =>
    new Date(timestamp).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const wasEdited = (c: Comment): boolean => {
    if (!c.updatedAt) return false;
    return new Date(c.updatedAt).getTime() - new Date(c.timestamp).getTime() > 1500;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-slate-800">
            Comentarios y Cambios
          </h3>
          <p className="text-sm text-slate-600">
            {comments.length} comentario{comments.length !== 1 ? 's' : ''} registrado
            {comments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => {
            setIsAdding((v) => !v);
            setEditingId(null);
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${
            isAdding ? 'bg-slate-200 text-slate-700' : 'bg-amber-600 text-white hover:bg-amber-700'
          }`}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{isAdding ? 'Cancelar' : 'Agregar'}</span>
        </button>
      </div>

      {isAdding && (
        <div className="mb-3">
          <RichCommentEditor
            placeholder="Describe los cambios de última hora o notas importantes..."
            submitLabel="Agregar comentario"
            onSubmit={(html) => {
              onAddComment(orderId, html);
              setIsAdding(false);
            }}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}

      <div className="space-y-2.5">
        {comments.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm sm:text-base">No hay comentarios aún</p>
            <p className="text-xs sm:text-sm mt-1">
              Agrega notas sobre cambios de última hora o información importante
            </p>
          </div>
        ) : (
          [...comments]
            .sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
            )
            .map((comment) => {
              const isEditing = editingId === comment.id;
              return (
                <div
                  key={comment.id}
                  className="p-3 sm:p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-slate-600">
                      {formatTimestamp(comment.timestamp)}
                    </span>
                    {wasEdited(comment) && (
                      <span className="text-[11px] text-slate-500 italic">
                        (editado)
                      </span>
                    )}
                  </div>

                  {isEditing ? (
                    <RichCommentEditor
                      initialHtml={comment.text}
                      submitLabel="Guardar cambios"
                      onSubmit={(html) => {
                        onUpdateComment(orderId, comment.id, html);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <SafeHtml
                        html={comment.text}
                        className="text-slate-800 text-sm sm:text-base break-words whitespace-pre-wrap flex-1"
                      />
                      <div className="flex flex-col sm:flex-row gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            setEditingId(comment.id);
                            setIsAdding(false);
                          }}
                          className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Editar comentario"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => onDeleteComment(orderId, comment.id)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar comentario"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>

      {comments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-500 text-center">
            Los comentarios se ordenan del más reciente al más antiguo
          </p>
        </div>
      )}
    </div>
  );
};

export default Comments;
