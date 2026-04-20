import Foundation
import PDFKit
import AppKit

let inputURL = URL(fileURLWithPath: "/Users/prasidha/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/EBB8708C-BE05-4FBB-BF60-E44A9ADD5D2E/CC4003NI_CW_Logbook3.pdf")
let outputURL = URL(fileURLWithPath: "/Users/prasidha/screeningpilot/screeningpilot/CC4003NI_CW_Logbook3.pdf")
let tempPageURL = URL(fileURLWithPath: "/Users/prasidha/screeningpilot/screeningpilot/tmp/pdf_tools/metrics_page.pdf")

let pageWidth: CGFloat = 612
let pageHeight: CGFloat = 792

let metrics = [
    "Hardware Components: 100% of core drone components acquired and documented",
    "AI Model Performance: Achieved mAP@0.5 of 56.6% on rice disease validation set",
    "Dataset Expansion: Integrated 2,500+ annotated images for rice and wheat diseases",
    "System Integration: Established complete data pipeline (Flutter → Backend → AI → Firebase)",
    "Testing Coverage: Validated system with 50+ test images across different conditions",
    "Model Optimization: Reduced inference time to 50-80ms per image",
    "Multi-Crop Support: Successfully extended system from single-crop (rice) to dual-crop (rice + wheat)"
]

func loadFont(name: String, size: CGFloat, weight: NSFont.Weight? = nil) -> NSFont {
    if let font = NSFont(name: name, size: size) {
        return font
    }
    if let weight {
        return NSFont.systemFont(ofSize: size, weight: weight)
    }
    return NSFont.systemFont(ofSize: size)
}

func drawText(
    _ text: String,
    in rect: CGRect,
    font: NSFont,
    paragraphStyle: NSParagraphStyle? = nil
) -> CGFloat {
    let style = (paragraphStyle?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.black,
        .paragraphStyle: style
    ]
    let bounds = (text as NSString).boundingRect(
        with: rect.size,
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: attributes
    )
    let drawRect = CGRect(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: ceil(bounds.height) + 2)
    (text as NSString).draw(
        with: drawRect,
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: attributes
    )
    return ceil(bounds.height)
}

func buildMetricsPage(at url: URL, pageNumber: Int) throws {
    var mediaBox = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
    guard let context = CGContext(url as CFURL, mediaBox: &mediaBox, nil) else {
        throw NSError(domain: "PDFGeneration", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to create PDF context"])
    }

    context.beginPDFPage(nil)
    context.saveGState()
    context.translateBy(x: 0, y: pageHeight)
    context.scaleBy(x: 1, y: -1)

    let graphicsContext = NSGraphicsContext(cgContext: context, flipped: true)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext

    let headerFont = loadFont(name: "Arial-BoldMT", size: 12, weight: .bold)
    let titleFont = loadFont(name: "Arial-BoldMT", size: 18, weight: .bold)
    let bodyFont = loadFont(name: "ArialMT", size: 12)
    let footerFont = loadFont(name: "ArialMT", size: 12)

    let headerAttributes: [NSAttributedString.Key: Any] = [
        .font: headerFont,
        .foregroundColor: NSColor.black
    ]
    ("CC4003NI" as NSString).draw(at: CGPoint(x: 69, y: 39), withAttributes: headerAttributes)
    ("Introduction to Robotics and IoT" as NSString).draw(at: CGPoint(x: 367, y: 39), withAttributes: headerAttributes)

    var y: CGFloat = 92
    let contentX: CGFloat = 68
    let contentWidth: CGFloat = 470

    y += drawText("4.1 Quantitative Progress Metrics", in: CGRect(x: contentX, y: y, width: contentWidth, height: 60), font: titleFont)
    y += 26

    let paragraphStyle = NSMutableParagraphStyle()
    paragraphStyle.lineSpacing = 3
    y += drawText(
        "The following measurable achievements were accomplished this week:",
        in: CGRect(x: contentX, y: y, width: contentWidth, height: 80),
        font: bodyFont,
        paragraphStyle: paragraphStyle
    )
    y += 18

    let bulletStyle = NSMutableParagraphStyle()
    bulletStyle.lineSpacing = 3
    bulletStyle.headIndent = 16
    bulletStyle.firstLineHeadIndent = 0

    for item in metrics {
        let bulletText = "- \(item)"
        y += drawText(
            bulletText,
            in: CGRect(x: contentX, y: y, width: contentWidth, height: 120),
            font: bodyFont,
            paragraphStyle: bulletStyle
        )
        y += 10
    }

    y += 8
    _ = drawText(
        "These metrics demonstrate substantial progress toward a production-ready agricultural monitoring system.",
        in: CGRect(x: contentX, y: y, width: contentWidth, height: 80),
        font: bodyFont,
        paragraphStyle: paragraphStyle
    )

    let footerAttributes: [NSAttributedString.Key: Any] = [
        .font: footerFont,
        .foregroundColor: NSColor.black
    ]
    ("[AgriDrone_Guardian]" as NSString).draw(at: CGPoint(x: 68, y: 754), withAttributes: footerAttributes)
    ("\(pageNumber)" as NSString).draw(at: CGPoint(x: 544, y: 754), withAttributes: footerAttributes)

    NSGraphicsContext.restoreGraphicsState()
    context.restoreGState()
    context.endPDFPage()
    context.closePDF()
}

guard let sourceDocument = PDFDocument(url: inputURL) else {
    fputs("Failed to open input PDF.\n", stderr)
    exit(1)
}

do {
    try? FileManager.default.removeItem(at: tempPageURL)
    try? FileManager.default.removeItem(at: outputURL)
    try buildMetricsPage(at: tempPageURL, pageNumber: sourceDocument.pageCount + 1)

    guard let metricsDocument = PDFDocument(url: tempPageURL),
          let metricsPage = metricsDocument.page(at: 0) else {
        fputs("Failed to build metrics page.\n", stderr)
        exit(1)
    }

    sourceDocument.insert(metricsPage, at: sourceDocument.pageCount)
    if sourceDocument.write(to: outputURL) {
        print(outputURL.path)
    } else {
        fputs("Failed to write output PDF.\n", stderr)
        exit(1)
    }
} catch {
    fputs("Error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
