import javax.swing.*;
import javax.swing.border.*;
import java.awt.*;
import java.awt.event.*;
import java.awt.geom.*;
import java.util.ArrayList;
import java.io.*;

public class SubscriptionGUI extends JFrame implements ActionListener {

    ArrayList<AIModel> planList = new ArrayList<AIModel>();

    static final Color BG_DARK    = new Color(10, 12, 24);
    static final Color BG_CARD    = new Color(18, 22, 42);
    static final Color ACCENT     = new Color(99, 179, 237);
    static final Color ACCENT2    = new Color(154, 117, 234);
    static final Color SUCCESS    = new Color(72, 199, 142);
    static final Color DANGER     = new Color(252, 100, 94);
    static final Color TEXT_MAIN  = new Color(225, 230, 255);
    static final Color TEXT_DIM   = new Color(120, 130, 165);
    static final Color BORDER_CLR = new Color(40, 50, 90);

    JTextField tfName, tfPrice, tfParams, tfContext,
               tfQuotaSlots, tfPromptText, tfResponseLen,
               tfMemberName, tfIndex;

    JTextArea outputArea;

    JButton btnAddPersonal, btnAddPro, btnDisplayAll, btnClear,
            btnGivePrompt, btnAddMember, btnRemoveMember,
            btnCheckType, btnExport, btnLoad;

    public SubscriptionGUI() {
        setTitle("AI Subscription Manager");
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setSize(900, 680);
        setLocationRelativeTo(null);
        setBackground(BG_DARK);

        JPanel root = new JPanel(new BorderLayout(0, 0));
        root.setBackground(BG_DARK);
        root.setBorder(new EmptyBorder(16, 16, 16, 16));
        setContentPane(root);

        root.add(buildHeader(), BorderLayout.NORTH);
        root.add(buildCenter(), BorderLayout.CENTER);
        root.add(buildOutputPanel(), BorderLayout.SOUTH);
    }

    private JPanel buildHeader() {
        JPanel p = new JPanel(new BorderLayout());
        p.setBackground(BG_DARK);
        p.setBorder(new EmptyBorder(0, 0, 14, 0));

        JLabel title = new JLabel("AI Model Subscription Manager");
        title.setFont(new Font("Monospaced", Font.BOLD, 20));
        title.setForeground(ACCENT);

        JLabel sub = new JLabel("CS4001 Java OOP Coursework");
        sub.setFont(new Font("Monospaced", Font.PLAIN, 11));
        sub.setForeground(TEXT_DIM);

        JPanel left = new JPanel(new GridLayout(2, 1, 2, 2));
        left.setBackground(BG_DARK);
        left.add(title);
        left.add(sub);
        p.add(left, BorderLayout.WEST);

        return p;
    }

    private JPanel buildCenter() {
        JPanel center = new JPanel(new GridLayout(1, 2, 12, 0));
        center.setBackground(BG_DARK);
        center.add(buildInputCard());
        center.add(buildActionsCard());
        return center;
    }

    private JPanel buildInputCard() {
        JPanel card = createCard("Plan Details");

        tfName        = addRow(card, "Model Name", "e.g. DeepSeek-R1");
        tfPrice       = addRow(card, "Price (Rs/1L tok)", "e.g. 350.0");
        tfParams      = addRow(card, "Parameters (B)", "e.g. 90");
        tfContext     = addRow(card, "Context Window", "e.g. 96000");
        tfQuotaSlots  = addRow(card, "Tokens / Slots", "Personal=Tokens, Pro=Slots");

        card.add(Box.createVerticalStrut(10));
        addSectionLabel(card, "Personal / Pro Prompt");
        tfPromptText  = addRow(card, "Prompt Text", "Enter your query...");
        tfResponseLen = addRow(card, "Output Tokens", "e.g. 300");

        card.add(Box.createVerticalStrut(6));
        addSectionLabel(card, "Pro Plan Actions");
        tfMemberName  = addRow(card, "Member Name", "e.g. Sita Sharma");

        card.add(Box.createVerticalStrut(6));
        addSectionLabel(card, "Index Lookup");
        tfIndex       = addRow(card, "Index Number", "0, 1, 2 ...");

        card.add(Box.createVerticalGlue());
        return card;
    }

    private JPanel buildActionsCard() {
        JPanel card = createCard("Actions");

        addSectionLabel(card, "ADD PLANS");
        btnAddPersonal = addBtn(card, "Add Personal Plan", ACCENT);
        btnAddPro      = addBtn(card, "Add Pro Plan", ACCENT2);

        card.add(Box.createVerticalStrut(8));
        addSectionLabel(card, "VIEW & MANAGE");
        btnDisplayAll  = addBtn(card, "Display All Plans", new Color(60, 80, 140));
        btnCheckType   = addBtn(card, "Check Plan Type", new Color(60, 80, 140));
        btnClear       = addBtn(card, "Clear Fields", new Color(50, 55, 80));

        card.add(Box.createVerticalStrut(8));
        addSectionLabel(card, "PROMPT");
        btnGivePrompt  = addBtn(card, "Give a Prompt", SUCCESS);

        card.add(Box.createVerticalStrut(8));
        addSectionLabel(card, "PRO PLAN");
        btnAddMember    = addBtn(card, "Add Team Member", ACCENT2);
        btnRemoveMember = addBtn(card, "Remove Team Member", DANGER);

        card.add(Box.createVerticalStrut(8));
        addSectionLabel(card, "FILE I/O");
        btnExport = addBtn(card, "Export to File", new Color(60, 100, 80));
        btnLoad   = addBtn(card, "Load from File", new Color(60, 100, 80));

        card.add(Box.createVerticalGlue());
        return card;
    }

    private JPanel buildOutputPanel() {
        JPanel p = new JPanel(new BorderLayout());
        p.setBackground(BG_DARK);
        p.setBorder(new EmptyBorder(12, 0, 0, 0));

        JLabel lbl = new JLabel("Output Console");
        lbl.setFont(new Font("Monospaced", Font.BOLD, 12));
        lbl.setForeground(ACCENT);
        lbl.setBorder(new EmptyBorder(0, 0, 4, 0));

        outputArea = new JTextArea(8, 40);
        outputArea.setBackground(new Color(6, 8, 18));
        outputArea.setForeground(SUCCESS);
        outputArea.setFont(new Font("Monospaced", Font.PLAIN, 13));
        outputArea.setCaretColor(ACCENT);
        outputArea.setEditable(false);
        outputArea.setBorder(new EmptyBorder(10, 12, 10, 12));
        outputArea.setText("System ready. Add a plan to begin.\n");

        JScrollPane scroll = new JScrollPane(outputArea);
        scroll.setBorder(BorderFactory.createLineBorder(BORDER_CLR, 1));
        scroll.setBackground(BG_DARK);

        p.add(lbl, BorderLayout.NORTH);
        p.add(scroll, BorderLayout.CENTER);
        return p;
    }

    public void actionPerformed(ActionEvent e) {
        Object src = e.getSource();

        if (src == btnAddPersonal) {
            try {
                String name = tfName.getText().trim();
                double price = Double.parseDouble(tfPrice.getText().trim());
                int params = Integer.parseInt(tfParams.getText().trim());
                int context = Integer.parseInt(tfContext.getText().trim());
                int tokens = Integer.parseInt(tfQuotaSlots.getText().trim());

                if (name.isEmpty()) {
                    throw new Exception("Model name is empty.");
                }

                planList.add(new PersonalPlan(name, price, params, context, tokens));
                print("Personal Plan added at index [" + (planList.size() - 1) + "]");
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, "Invalid input for Personal Plan.", "Input Error", JOptionPane.ERROR_MESSAGE);
            }

        } else if (src == btnAddPro) {
            try {
                String name = tfName.getText().trim();
                double price = Double.parseDouble(tfPrice.getText().trim());
                int params = Integer.parseInt(tfParams.getText().trim());
                int context = Integer.parseInt(tfContext.getText().trim());
                int slots = Integer.parseInt(tfQuotaSlots.getText().trim());

                if (name.isEmpty()) {
                    throw new Exception("Model name is empty.");
                }

                planList.add(new ProPlan(name, price, params, context, slots));
                print("Pro Plan added at index [" + (planList.size() - 1) + "]");
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, "Invalid input for Pro Plan.", "Input Error", JOptionPane.ERROR_MESSAGE);
            }

        } else if (src == btnDisplayAll) {
            if (planList.isEmpty()) {
                print("No plans added yet.");
                return;
            }

            outputArea.setText("");
            for (int i = 0; i < planList.size(); i++) {
                print("----- Plan Index: " + i + " -----");
                print(planList.get(i).display());
                print("");
            }

        } else if (src == btnClear) {
            tfName.setText("");
            tfPrice.setText("");
            tfParams.setText("");
            tfContext.setText("");
            tfQuotaSlots.setText("");
            tfPromptText.setText("");
            tfResponseLen.setText("");
            tfMemberName.setText("");
            tfIndex.setText("");
            print("Fields cleared.");

        } else if (src == btnGivePrompt) {
            int idx = getIndex();
            if (idx == -1) {
                return;
            }

            try {
                String promptText = tfPromptText.getText().trim();
                int responseLen = Integer.parseInt(tfResponseLen.getText().trim());

                AIModel obj = planList.get(idx);

                if (obj instanceof PersonalPlan) {
                    PersonalPlan pp = (PersonalPlan) obj;
                    print(pp.enterPrompt(promptText, responseLen));
                } else if (obj instanceof ProPlan) {
                    ProPlan pro = (ProPlan) obj;
                    print(pro.enterPrompt(promptText, responseLen));
                } else {
                    print("Unknown plan type.");
                }
            } catch (NumberFormatException ex) {
                JOptionPane.showMessageDialog(this, "Please enter valid output tokens.", "Input Error", JOptionPane.ERROR_MESSAGE);
            }

        } else if (src == btnAddMember) {
            int idx = getIndex();
            if (idx == -1) {
                return;
            }

            AIModel obj = planList.get(idx);
            if (obj instanceof ProPlan) {
                ProPlan pro = (ProPlan) obj;
                print(pro.addTeamMember(tfMemberName.getText().trim()));
            } else {
                JOptionPane.showMessageDialog(this, "This operation is only for Pro Plan.", "Type Error", JOptionPane.ERROR_MESSAGE);
            }

        } else if (src == btnRemoveMember) {
            int idx = getIndex();
            if (idx == -1) {
                return;
            }

            AIModel obj = planList.get(idx);
            if (obj instanceof ProPlan) {
                ProPlan pro = (ProPlan) obj;
                print(pro.removeTeamMember(tfMemberName.getText().trim()));
            } else {
                JOptionPane.showMessageDialog(this, "This operation is only for Pro Plan.", "Type Error", JOptionPane.ERROR_MESSAGE);
            }

        } else if (src == btnCheckType) {
            int idx = getIndex();
            if (idx == -1) {
                return;
            }

            AIModel obj = planList.get(idx);

            if (obj instanceof PersonalPlan) {
                print("Plan at index [" + idx + "] is Personal Plan.");
            } else if (obj instanceof ProPlan) {
                print("Plan at index [" + idx + "] is Pro Plan.");
            } else {
                print("Unknown plan type.");
            }

        } else if (src == btnExport) {
            exportToFile();

        } else if (src == btnLoad) {
            loadFromFile();
        }
    }

    private int getIndex() {
        int idx = -1;

        try {
            idx = Integer.parseInt(tfIndex.getText().trim());

            if (idx < 0 || idx >= planList.size()) {
                JOptionPane.showMessageDialog(this,
                        "Index out of range. Valid index is from 0 to " + (planList.size() - 1),
                        "Index Error",
                        JOptionPane.ERROR_MESSAGE);
                return -1;
            }
        } catch (NumberFormatException ex) {
            JOptionPane.showMessageDialog(this,
                    "Please enter a valid integer index.",
                    "Input Error",
                    JOptionPane.ERROR_MESSAGE);
            return -1;
        }

        return idx;
    }

    private void exportToFile() {
        try {
            PrintWriter pw = new PrintWriter(new FileWriter("plans_export.txt"));

            for (int i = 0; i < planList.size(); i++) {
                pw.println("=== Plan [" + i + "] ===");
                pw.println(planList.get(i).display());
                pw.println();
            }

            pw.close();
            print("Exported successfully to plans_export.txt");
        } catch (IOException ex) {
            print("Export failed: " + ex.getMessage());
        }
    }

    private void loadFromFile() {
        try {
            BufferedReader br = new BufferedReader(new FileReader("plans_export.txt"));
            outputArea.setText("");

            String line;
            while ((line = br.readLine()) != null) {
                outputArea.append(line + "\n");
            }

            br.close();
            print("File loaded successfully.");
        } catch (IOException ex) {
            print("Load failed: " + ex.getMessage());
        }
    }

    private void print(String msg) {
        outputArea.append(msg + "\n");
        outputArea.setCaretPosition(outputArea.getDocument().getLength());
    }

    private JPanel createCard(String title) {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        card.setBackground(BG_CARD);
        card.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(BORDER_CLR, 1),
                new EmptyBorder(14, 16, 14, 16)
        ));

        JLabel lbl = new JLabel(title);
        lbl.setFont(new Font("Monospaced", Font.BOLD, 13));
        lbl.setForeground(ACCENT);
        lbl.setAlignmentX(LEFT_ALIGNMENT);
        lbl.setBorder(new EmptyBorder(0, 0, 10, 0));
        card.add(lbl);
        return card;
    }

    private JTextField addRow(JPanel card, String label, String hint) {
        JPanel row = new JPanel(new BorderLayout(8, 0));
        row.setBackground(BG_CARD);
        row.setMaximumSize(new Dimension(Integer.MAX_VALUE, 32));
        row.setAlignmentX(LEFT_ALIGNMENT);

        JLabel lbl = new JLabel(label);
        lbl.setFont(new Font("Monospaced", Font.PLAIN, 11));
        lbl.setForeground(TEXT_DIM);
        lbl.setPreferredSize(new Dimension(148, 24));

        JTextField tf = new JTextField();
        tf.setFont(new Font("Monospaced", Font.PLAIN, 12));
        tf.setBackground(new Color(14, 18, 36));
        tf.setForeground(TEXT_MAIN);
        tf.setCaretColor(ACCENT);
        tf.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(BORDER_CLR, 1),
                new EmptyBorder(2, 6, 2, 6)
        ));
        tf.setToolTipText(hint);

        row.add(lbl, BorderLayout.WEST);
        row.add(tf, BorderLayout.CENTER);
        card.add(row);
        card.add(Box.createVerticalStrut(5));
        return tf;
    }

    private JButton addBtn(JPanel card, String text, Color color) {
        JButton btn = new JButton(text) {
            protected void paintComponent(Graphics g) {
                Graphics2D g2 = (Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

                if (getModel().isPressed()) {
                    g2.setColor(color.darker());
                } else if (getModel().isRollover()) {
                    g2.setColor(color.brighter());
                } else {
                    g2.setColor(new Color(color.getRed(), color.getGreen(), color.getBlue(), 40));
                }

                g2.fillRoundRect(0, 0, getWidth(), getHeight(), 8, 8);
                g2.setColor(color);
                g2.setStroke(new BasicStroke(1.2f));
                g2.drawRoundRect(0, 0, getWidth() - 1, getHeight() - 1, 8, 8);
                g2.dispose();

                super.paintComponent(g);
            }
        };

        btn.setFont(new Font("Monospaced", Font.BOLD, 12));
        btn.setForeground(color);
        btn.setBackground(new Color(0, 0, 0, 0));
        btn.setOpaque(false);
        btn.setContentAreaFilled(false);
        btn.setBorderPainted(false);
        btn.setFocusPainted(false);
        btn.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btn.setMaximumSize(new Dimension(Integer.MAX_VALUE, 34));
        btn.setAlignmentX(LEFT_ALIGNMENT);
        btn.addActionListener(this);

        card.add(btn);
        card.add(Box.createVerticalStrut(4));
        return btn;
    }

    private void addSectionLabel(JPanel card, String text) {
        JLabel lbl = new JLabel(text);
        lbl.setFont(new Font("Monospaced", Font.BOLD, 10));
        lbl.setForeground(TEXT_DIM);
        lbl.setAlignmentX(LEFT_ALIGNMENT);
        lbl.setBorder(new EmptyBorder(4, 0, 4, 0));
        card.add(lbl);
    }

    public static void main(String[] args) {
        try {
            UIManager.setLookAndFeel(UIManager.getCrossPlatformLookAndFeelClassName());
        } catch (Exception e) {
        }

        SwingUtilities.invokeLater(new Runnable() {
            public void run() {
                new SubscriptionGUI().setVisible(true);
            }
        });
    }
}
